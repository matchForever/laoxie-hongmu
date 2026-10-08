'use strict';
// Browser -> GitHub only. Credentials never enter a catalog, URL or commit.
(function (root) {
  const asset = /^assets\/(?:[\w-]+\/)*[\w-]+\.(?:jpg|jpeg|png|webp)$/;
  const shaPattern = /^[a-f0-9]{40}$/;
  const conflict = () => new Error('其他设备刚修改了家具。当前填写内容会保留，请复制后重新登录，读取最新资料再修改，避免覆盖。');
  function cleanCatalog(source) {
    if (!source || !source.store || !Array.isArray(source.products) || source.products.length > 500) throw new Error('家具资料格式异常，请联系网站维护。');
    const store = {};
    for (const [key, limit] of Object.entries({name:100, intro:1000, phone:30, address:200, hours:100, hero:200})) {
      const value = source.store[key] ?? '';
      if (typeof value !== 'string' || value.length > limit) throw new Error('门店信息格式或长度不正确。');
      store[key] = value;
    }
    if (!asset.test(store.hero)) throw new Error('门店封面地址不正确。');
    const ids = new Set();
    const products = source.products.map(item => {
      const p = {};
      for (const [key, limit] of Object.entries({id:100, name:60, category:30, material:100, description:2000})) {
        const value = item[key] ?? '';
        if (typeof value !== 'string' || (['id','name','category'].includes(key) && !value.trim()) || value.length > limit) throw new Error('请检查家具名称、分类及填写内容的长度。');
        p[key] = value.trim();
      }
      if(p.category==='全部') throw new Error('请填写具体的家具分类。');
      if (!/^[\w-]+$/.test(p.id) || ids.has(p.id)) throw new Error('家具编号重复或格式不正确。');
      ids.add(p.id);
      for (const key of ['length','width','height']) {
        const value = item[key];
        if (value == null || value === '') { p[key] = null; continue; }
        if (!Number.isFinite(value) || value < 1 || value > 2000) throw new Error('尺寸可不填；填写时请使用 1 到 2000 厘米之间的数字。');
        p[key] = value;
      }
      for (const key of ['visible','featured','example']) {
        if (typeof item[key] !== 'boolean') throw new Error('家具展示设置格式不正确。');
        p[key] = item[key];
      }
      if (!Array.isArray(item.images) || !item.images.length || item.images.length > 5 || item.images.some(image => typeof image !== 'string' || !asset.test(image))) throw new Error('家具照片地址不正确。');
      p.images = item.images.slice();
      return p;
    });
    return {store, products};
  }
  function decodeUTF8(value) {
    const bytes = atob(value.replace(/\s/g, ''));
    return decodeURIComponent(Array.from(bytes, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  }
  class GitHubFurnitureStore {
    constructor(config) {
      if (!/^[\w-]+$/.test(config.owner) || !/^[\w.-]+$/.test(config.repo) || !/^[\w/-]+$/.test(config.branch)) throw new Error('网站仓库配置不正确。');
      this.owner = config.owner;
      this.repo = '/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo);
      this.branch = config.branch;
      this.key = '';
      this.snapshot = null;
    }
    async request(path, options = {}) {
      if (!this.key) throw new Error('请先登录管理。');
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 30000) : null;
      try {
        const response = await fetch('https://api.github.com' + path, {
          method:options.method || 'GET', cache:'no-store', redirect:'error',
          headers:{Accept:'application/vnd.github+json', Authorization:'Bearer ' + this.key, ...(options.body ? {'Content-Type':'application/json'} : {})},
          ...(options.body ? {body:JSON.stringify(options.body)} : {}),
          ...(controller ? {signal:controller.signal} : {})
        });
        if (!response.ok) {
          let message = '服务暂时无法处理请求，请稍后重试。当前填写内容会保留。';
          if (response.status === 401) message = '登录凭证无效或已到期，请更新后重新登录。';
          if (response.status === 403 || response.status === 404) message = '当前凭证没有店铺管理权限，或服务暂时限制访问，请稍后重试或联系维护人员。';
          if (response.status === 409 || response.status === 422) message = conflict().message;
          if (response.status === 429) message = '操作较频繁，请稍后重试。当前填写内容会保留。';
          const error = new Error(message); error.status = response.status; throw error;
        }
        return await response.json();
      } catch (e) {
        if (e.status) throw e;
        const error = new Error('连接失败，请检查网络后重试。当前填写内容会保留。');
        error.network = true; throw error;
      } finally { if (timer !== null) clearTimeout(timer); }
    }
    async readSnapshot() {
      const ref = await this.request(this.repo + '/git/ref/heads/' + this.branch);
      const head = ref.object?.sha;
      if (!shaPattern.test(head || '')) throw new Error('仓库版本异常，请联系网站维护。');
      const file = await this.request(this.repo + '/contents/data.json?ref=' + head);
      if (file.encoding !== 'base64' || !shaPattern.test(file.sha || '') || file.size > 2 * 1024 * 1024) throw new Error('家具文件格式异常，请联系网站维护。');
      const catalog = JSON.parse(decodeUTF8(file.content));
      cleanCatalog(catalog);
      const version = catalog._publication?.version ?? 0;
      if (!Number.isSafeInteger(version) || version < 0) throw new Error('家具版本格式异常，请联系网站维护。');
      return {head, sha:file.sha, catalog};
    }
    async login(key) {
      this.logout();
      if (!/^(github_pat_|gh[pousr]_)[A-Za-z0-9_]+$/.test(key) || key.length < 20 || key.length > 300) throw new Error('请填写有效的登录凭证。');
      this.key = key;
      try {
        const account = await this.request('/user');
        if (account.login?.toLowerCase() !== this.owner.toLowerCase()) throw new Error('当前凭证没有这家店铺的管理权限。');
        this.snapshot = await this.readSnapshot();
        return this.snapshot.catalog;
      } catch (e) { this.logout(); throw e; }
    }
    logout() { this.key = ''; this.snapshot = null; }
    async image(path) {
      if (!asset.test(path) || !this.snapshot) throw new Error('照片地址不正确。');
      const photo = await this.request(this.repo + '/contents/' + path + '?ref=' + this.snapshot.head);
      if (photo.encoding !== 'base64' || photo.size > 800000) throw new Error('照片格式不正确。');
      const mime = /\.png$/.test(path) ? 'png' : /\.webp$/.test(path) ? 'webp' : 'jpeg';
      return 'data:image/' + mime + ';base64,' + photo.content.replace(/\s/g, '');
    }
    async save(source, photos = []) {
      if (!this.snapshot) throw new Error('请先登录管理。');
      const candidate = cleanCatalog(source);
      const previousSha = this.snapshot.sha;
      let current = await this.readSnapshot();
      if (current.sha !== previousSha) throw conflict();
      candidate._publication = {version:(current.catalog._publication?.version ?? 0) + 1, updatedAt:new Date().toISOString()};
      const paths = new Set(candidate.products.flatMap(p => p.images));
      const entries = [];
      for (const photo of photos) {
        if (!/^assets\/uploads\/[\w-]+\.jpg$/.test(photo.path) || !paths.has(photo.path) || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo.dataURL) || photo.dataURL.length > 1000000) throw new Error('待上传照片格式不正确。');
        const bytes = atob(photo.dataURL.split(',')[1]);
        if (bytes.length < 4 || bytes.length > 800000 || bytes.slice(0,3) !== '\xff\xd8\xff') throw new Error('待上传照片不是有效 JPG。');
        if (!shaPattern.test(photo.blobSha || '')) {
          const blob = await this.request(this.repo + '/git/blobs', {method:'POST', body:{content:photo.dataURL.split(',')[1], encoding:'base64'}});
          if (!shaPattern.test(blob.sha || '')) throw new Error('照片上传未确认，请重试。');
          photo.blobSha = blob.sha;
        }
        entries.push({path:photo.path, mode:'100644', type:'blob', sha:photo.blobSha});
      }
      const data = await this.request(this.repo + '/git/blobs', {method:'POST', body:{content:JSON.stringify(candidate,null,2) + '\n', encoding:'utf-8'}});
      if (!shaPattern.test(data.sha || '')) throw new Error('家具资料上传未确认，请重试。');
      entries.push({path:'data.json', mode:'100644', type:'blob', sha:data.sha});
      // One commit publishes the catalog and every new photo together. Never force
      // a branch update; rebase only if other work did not change furniture data.
      for (let attempt = 0; attempt < 2; attempt++) {
        const base = await this.request(this.repo + '/git/commits/' + current.head);
        const tree = await this.request(this.repo + '/git/trees', {method:'POST', body:{base_tree:base.tree.sha, tree:entries}});
        const commit = await this.request(this.repo + '/git/commits', {method:'POST', body:{message:'更新店铺家具资料与照片', tree:tree.sha, parents:[current.head]}});
        try {
          await this.request(this.repo + '/git/refs/heads/' + this.branch, {method:'PATCH', body:{sha:commit.sha, force:false}});
          this.snapshot = {head:commit.sha, sha:data.sha, catalog:candidate};
          return candidate;
        } catch (e) {
          if (!e.network && e.status !== 409 && e.status !== 422) throw e;
          const latest = await this.readSnapshot();
          // A connection can drop after GitHub accepted the commit. Recognize it
          // instead of submitting a duplicate item when the owner retries.
          if (latest.sha === data.sha) { this.snapshot = latest; return latest.catalog; }
          if (latest.sha !== previousSha) throw conflict();
          if (e.network || attempt === 1) throw e;
          current = latest;
        }
      }
    }
  }
  root.GitHubFurnitureStore = GitHubFurnitureStore;
})(window);
