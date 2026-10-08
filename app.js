'use strict';
const $ = (q, root = document) => root.querySelector(q);
const cfg = window.STORE_CONFIG;
const apiRoot = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
let catalog, original, mode = null, token = '', catalogSha = '', category = '全部';
let editId = null, photos = [], busy = false, processing = false, toastTimer;
const clone = v => structuredClone(v);
const text = (tag, value, className) => { const n = document.createElement(tag); n.textContent = value; if (className) n.className = className; return n; };
function imageSource(value) {
  if (typeof value !== 'string') return '';
  if (/^assets\/[\w/.-]+$/.test(value)) return mode === 'live' ? `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${value}` : value;
  if (mode === 'demo' && /^data:image\/(jpeg|png|webp);base64,/.test(value)) return value;
  return '';
}
function imageNode(value, alt, className) { const img = document.createElement('img'); img.src = imageSource(value); img.alt = alt; if (className) img.className = className; img.loading = 'lazy'; return img; }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function show(id) { $(id).showModal(); }
function dimensions(p) { return `长 ${p.length} × 宽 ${p.width} × 高 ${p.height} cm`; }
function contact(container) {
  container.replaceChildren(); const s = catalog.store;
  if (s.address) container.append(text('p', `门店地址：${s.address}`, 'contact-line'));
  if (s.hours) container.append(text('p', `营业时间：${s.hours}`, 'contact-line'));
  if (s.phone) { container.append(text('p', `联系电话：${s.phone}`, 'contact-line')); const a = text('a', '打电话咨询', 'contact-link'); a.href = `tel:${s.phone.replace(/[^\d+]/g, '')}`; container.append(a); }
}
function render() {
  $('#store-intro').textContent = catalog.store.intro;
  contact($('#store-contact')); $('#contact-pending').hidden = Boolean(catalog.store.phone || catalog.store.address);
  $('#hero-img').src = imageSource(catalog.store.hero);
  const categories = ['全部', ...new Set(catalog.products.filter(p => p.visible).map(p => p.category))];
  if (!categories.includes(category)) category = '全部';
  $('#filters').replaceChildren();
  for (const c of categories) { const b = text('button', c, c === category ? 'active' : ''); b.setAttribute('aria-pressed', c === category); b.onclick = () => { category = c; render(); }; $('#filters').append(b); }
  const items = catalog.products.filter(p => p.visible && (category === '全部' || p.category === category)).sort((a,b) => Number(b.featured) - Number(a.featured));
  $('#count').textContent = `${items.length} 件家具`; $('#grid').replaceChildren();
  for (const p of items) {
    const card = text('button', '', 'card'); card.setAttribute('aria-label', `查看${p.name}的图片和尺寸`);
    const picture = text('div', '', 'card-photo'); picture.append(imageNode(p.images[0], p.name));
    if (p.featured) picture.append(text('span', '店内推荐', 'badge'));
    const body = text('div', '', 'card-body'); body.append(text('p', p.category, 'card-category'), text('h3', p.name), text('p', p.description, 'card-description'));
    const size = text('div', '', 'card-size'); size.append(text('span', dimensions(p)), text('span', '查看详情')); body.append(size); card.append(picture, body); card.onclick = () => openDetail(p); $('#grid').append(card);
  }
  if (!items.length) $('#grid').append(text('p', '这个分类暂时没有家具，换个分类看看。', 'empty'));
  $('#example-note').hidden = !catalog.products.some(p => p.visible && p.example);
  $('#preview-banner').hidden = mode !== 'demo'; document.body.classList.toggle('preview', mode === 'demo');
  $('#owner-entry').textContent = mode ? '⌑ 家具管理' : '⌑ 老板登录';
}
function openDetail(p) {
  $('#detail-name').textContent = p.name; $('#detail-category').textContent = `${p.category} / 家具详情`; $('#detail-material').textContent = `材质：${p.material}`;
  $('#detail-description').textContent = p.description; $('#detail-image').src = imageSource(p.images[0]); $('#detail-image').alt = p.name;
  $('#detail-dimensions').replaceChildren();
  for (const [label, value] of [['长',p.length],['宽',p.width],['高',p.height]]) { const d = text('div',''); d.append(text('strong', value), text('span', `${label} / 厘米`)); $('#detail-dimensions').append(d); }
  $('#detail-thumbs').replaceChildren();
  p.images.forEach((url, index) => { const b = text('button', '', index === 0 ? 'active' : ''); b.setAttribute('aria-label', `查看第 ${index + 1} 张图片`); b.append(imageNode(url,p.name)); b.onclick = () => { $('#detail-image').src = imageSource(url); for (const t of $('#detail-thumbs').children) t.classList.remove('active'); b.classList.add('active'); }; $('#detail-thumbs').append(b); });
  $('#detail-example').textContent = p.example ? '效果预览：图片、材质和尺寸为示例，以门店实物为准。' : '尺寸为人工测量，实际尺寸请以门店实物为准。';
  contact($('#detail-contact')); show('#detail');
}
async function request(path, options = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  const r = await fetch(`${apiRoot}${path}`, {...options, headers});
  if (!r.ok) {
    if (r.status === 401) throw new Error('管理钥匙无效或已过期，请退出并重新登录。');
    if (r.status === 403) throw new Error('暂时无法保存：请确认管理钥匙有本仓库的 Contents 读写权限；若请求频繁，请稍后再试。');
    if (r.status === 409 || r.status === 422) throw new Error('其他设备可能刚修改了信息。请复制当前填写内容，刷新网页后重新编辑，避免覆盖他人的修改。');
    throw new Error(`连接失败（${r.status}），请检查网络后重试。`);
  }
  return r.json();
}
const encode = value => { const bytes = new TextEncoder().encode(value); let s=''; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s); };
const decode = value => new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,'')), c => c.charCodeAt(0)));
async function loadLive() { const file = await request(`/contents/data.json?ref=${cfg.branch}&t=${Date.now()}`); const data = JSON.parse(decode(file.content)); if (!Array.isArray(data.products) || !data.store) throw new Error('家具数据格式异常，请联系网站维护人员。'); catalogSha = file.sha; return data; }
function openAdmin() {
  $('#admin-mode').textContent = mode === 'demo' ? '体验模式 · 仅当前浏览器' : '正式管理 · 保存后发布到店铺';
  $('#admin-status').textContent = mode === 'demo' ? '放心试用。修改只在当前浏览器可见，退出后恢复正式店铺。' : '照片会自动压缩。保存后通常需要 1–3 分钟更新到公开网页。';
  renderAdmin(); show('#admin');
}
function renderAdmin() {
  $('#admin-list').replaceChildren();
  for (const p of catalog.products) {
    const row = text('div','','admin-row'); const info = text('div',''); info.append(text('h3', p.name), text('p', dimensions(p)), text('span', p.visible ? '展示中' : '已下架', 'tag'));
    const edit = text('button','编辑','secondary'); edit.onclick = () => openEditor(p);
    const toggle = text('button', p.visible ? '下架' : '重新展示','text-button');
    toggle.onclick = async () => { if (busy) return; setBusy(true); try { const next = clone(catalog); next.products.find(i=>i.id===p.id).visible = !p.visible; await persist(next); render(); renderAdmin(); toast(p.visible ? '家具已下架，可以随时重新展示。' : '家具已重新展示。'); } catch(e) { toast(e.message); } finally { setBusy(false); } };
    row.append(imageNode(p.images[0],p.name),info,edit,toggle); $('#admin-list').append(row);
  }
  if (!catalog.products.length) $('#admin-list').append(text('p','还没有家具，点击“新增家具”上传第一件。','empty'));
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('#admin button,#editor button,#editor input,#editor select,#editor textarea,#store-editor button,#store-editor input,#store-editor textarea').forEach(n => n.disabled = value);
  $('#save-product').textContent = value ? '正在保存，请稍候…' : '保存家具';
}
async function openDB() { return new Promise((resolve,reject)=>{ const r=indexedDB.open('laoxie-demo-v1',1); r.onupgradeneeded=()=>r.result.createObjectStore('drafts'); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(new Error('浏览器无法保存体验数据。请使用普通浏览模式。')); }); }
async function demoData(action, value) { const db=await openDB(); return new Promise((resolve,reject)=>{ const tx=db.transaction('drafts',action==='read'?'readonly':'readwrite'); const r=action==='read'?tx.objectStore('drafts').get('catalog'):tx.objectStore('drafts').put(value,'catalog'); tx.oncomplete=()=>{db.close();resolve(r.result);}; tx.onerror=()=>{db.close();reject(new Error('浏览器存储空间不足，请减少照片后重试。'));}; }); }
async function persist(next) {
  if (mode === 'demo') await demoData('write', next);
  else if (mode === 'live') {
    const result = await request('/contents/data.json', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'更新家具店信息',branch:cfg.branch,sha:catalogSha,content:encode(JSON.stringify(next,null,2)+'\n')})});
    catalogSha = result.content.sha;
  } else throw new Error('请先登录管理。');
  catalog = next;
}
function openEditor(p) {
  editId = p?.id || null; photos = (p?.images || []).map(url=>({url})); $('#product-form').reset(); $('#photo-input').value=''; $('#editor-error').textContent=''; $('#editor-title').textContent=p?'编辑家具':'新增家具';
  for (const key of ['name','category','material','length','width','height','description']) $('#product-form').elements.namedItem(key).value=p?.[key] ?? (key==='category'?'沙发':'');
  for (const key of ['visible','featured','example']) $('#product-form').elements.namedItem(key).checked=p?.[key] ?? (key==='visible');
  renderPhotos(); show('#editor');
}
function renderPhotos() {
  $('#photo-preview').replaceChildren(); photos.forEach((photo,i)=>{const div=text('div',''); const img=document.createElement('img'); img.src=photo.pending?photo.url:imageSource(photo.url); img.alt=`家具照片 ${i+1}`; const b=text('button','×'); b.type='button'; b.setAttribute('aria-label',`移除第 ${i+1} 张照片`); b.onclick=()=>{photos.splice(i,1);renderPhotos();}; div.append(img,b); $('#photo-preview').append(div);});
}
async function compress(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。iPhone 可选择“最兼容”照片格式。');
  if(file.size>30*1024*1024) throw new Error('单张原图不能超过 30 MB，请选择较小的照片。');
  const bitmap=await createImageBitmap(file); const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height)); const canvas=document.createElement('canvas'); canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale); const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let result=canvas.toDataURL('image/jpeg',.8); if(result.length>850000) result=canvas.toDataURL('image/jpeg',.55); if(result.length>1000000) throw new Error('图片仍然太大，请换一张或裁剪后上传。'); return result;
}
$('#photo-input').onchange=async event=>{if(busy||processing)return;const files=Array.from(event.target.files);if(files.length+photos.length>5){$('#editor-error').textContent='每件家具最多 5 张照片，请先移除不需要的照片。';event.target.value='';return;} processing=true;setBusy(true);$('#save-product').textContent='照片处理中…';$('#editor-error').textContent='';try{for(const f of files)photos.push({url:await compress(f),pending:true});renderPhotos();}catch(e){$('#editor-error').textContent=e.message;}finally{processing=false;setBusy(false);event.target.value='';}};
$('#product-form').onsubmit=async event=>{
  event.preventDefault();if(busy||processing)return;$('#editor-error').textContent='';
  if(!photos.length){$('#editor-error').textContent='请至少添加一张家具照片。';return;}
  const f=event.target; const p={id:editId || `furniture-${crypto.randomUUID()}`,name:f.elements.namedItem('name').value.trim(),category:f.elements.namedItem('category').value,material:f.elements.namedItem('material').value.trim(),description:f.elements.namedItem('description').value.trim(),images:[]};
  if(!p.name||!p.material||!p.description){$('#editor-error').textContent='名称、材质和介绍不能只填写空格。';return;}
  for(const key of ['length','width','height'])p[key]=Number(f.elements.namedItem(key).value);
  for(const key of ['visible','featured','example'])p[key]=f.elements.namedItem(key).checked;
  setBusy(true);
  try{
    for(const photo of photos){
      if(mode==='live'&&photo.pending){const path=`assets/uploads/${crypto.randomUUID()}.jpg`;await request(`/contents/${path}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:`添加家具照片：${p.name}`,branch:cfg.branch,content:photo.url.split(',')[1]})});photo.url=path;photo.pending=false;}
      p.images.push(photo.url);
    }
    const next=clone(catalog);const index=next.products.findIndex(i=>i.id===p.id);if(index<0)next.products.push(p);else next.products[index]=p;
    await persist(next);render();renderAdmin();$('#editor').close();toast(mode==='demo'?'已保存体验内容，仅当前浏览器可见。':'保存成功。公开店铺将在发布完成后更新。');
  }catch(e){$('#editor-error').textContent=e.message;}finally{setBusy(false);}
};
$('#owner-entry').onclick=()=>{if(mode)openAdmin();else show('#login');};
$('#login-form').onsubmit=async event=>{
  event.preventDefault(); const submit=$('button',event.target);submit.disabled=true;submit.textContent='正在验证…';$('#login-error').textContent='';token=$('#token').value.trim();
  try{
    const userResponse=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});
    if(!userResponse.ok)throw new Error('管理钥匙无效或已过期，请检查后重试。');const user=await userResponse.json();
    if(user.login.toLowerCase()!==cfg.owner.toLowerCase())throw new Error(`请使用店主账号 ${cfg.owner} 的管理钥匙。`);
    const repo=await request('');if(!repo.permissions?.push)throw new Error('此账号没有本店仓库的管理权限。');
    const data=await loadLive();mode='live';catalog=data;$('#token').value='';$('#login').close();render();openAdmin();
  }catch(e){token='';$('#login-error').textContent=e.message || '验证失败，请检查网络。';}finally{submit.disabled=false;submit.textContent='登录管理';}
};
$('#demo-login').onclick=async()=>{try{catalog=await demoData('read') || clone(original);mode='demo';token='';$('#token').value='';$('#login').close();render();openAdmin();}catch(e){$('#login-error').textContent=e.message;}};
function logout(){if(busy)return;mode=null;token='';catalog=clone(original);$('#token').value='';document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();toast('已退出管理。');}
$('#logout').onclick=logout;$('#preview-banner').onclick=logout;
$('#add-product').onclick=()=>openEditor();
$('#store-edit').onclick=()=>{const f=$('#store-form');for(const key of ['intro','phone','address','hours'])f.elements.namedItem(key).value=catalog.store[key]||'';$('#store-error').textContent='';show('#store-editor');};
$('#store-form').onsubmit=async event=>{event.preventDefault();if(busy)return;setBusy(true);$('#store-error').textContent='';try{const next=clone(catalog);for(const key of ['intro','phone','address','hours'])next.store[key]=event.target.elements.namedItem(key).value.trim();if(!next.store.intro)throw new Error('请填写门店介绍。');if(next.store.phone&&!/^[+\d\s()-]{5,30}$/.test(next.store.phone))throw new Error('请填写有效的联系电话。');await persist(next);render();$('#store-editor').close();toast('门店信息已保存。');}catch(e){$('#store-error').textContent=e.message;}finally{setBusy(false);}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(!busy)b.closest('dialog').close();});
document.querySelectorAll('dialog').forEach(d=>{d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});});
$('#year').textContent=new Date().getFullYear();
fetch(`data.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{catalog=data;original=clone(data);render();}).catch(()=>{$('#grid').replaceChildren(text('p','家具加载失败，请检查网络并刷新页面。','empty'));$('#owner-entry').disabled=true;});
