'use strict';
const $ = (q, root = document) => root.querySelector(q);
const cfg = window.STORE_CONFIG;
const manager = new window.GitHubFurnitureStore(cfg);
const previews = new Map(), imageRequests = new Map();
const keyStorage = 'laoxie-owner-key:' + cfg.owner + '/' + cfg.repo;
let catalog, original, mode = null, category = '全部';
let editId = null, photos = [], busy = false, processing = false, toastTimer;
// Catalog values are plain JSON; this also works on older phone browsers.
const clone = v => JSON.parse(JSON.stringify(v));
let publicLoading = false, publicVersion = -1, lastPublicFetch = 0;
const newProductId = () => 'furniture-' + (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const text = (tag, value, className) => { const n = document.createElement(tag); n.textContent = value; if (className) n.className = className; return n; };
function imageSource(value) {
  if (typeof value !== 'string') return '';
  if (/^assets\/(?:[\w-]+\/)*[\w-]+\.(jpg|jpeg|png|webp)$/.test(value)) return mode === 'live' && previews.has(value) ? previews.get(value) : value;
  return '';
}
function setImage(img, value) {
  img.onerror = async () => {
    img.onerror = null;
    if (mode !== 'live' || !imageSource(value).startsWith('assets/')) return;
    try {
      if (!imageRequests.has(value)) imageRequests.set(value, manager.image(value));
      const preview = await imageRequests.get(value);
      if (mode === 'live' && img.getAttribute('src') === value) { previews.set(value, preview); img.src = preview; }
    } catch { imageRequests.delete(value); }
  };
  img.src = imageSource(value);
}
function imageNode(value, alt, className) { const img = document.createElement('img'); setImage(img, value); img.alt = alt; if (className) img.className = className; img.loading = 'lazy'; return img; }
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
    const size = text('div', '', 'card-size'); size.append(text('span', dimensions(p)), text('span', '查看大图和介绍')); body.append(size); card.append(picture, body); card.onclick = () => openDetail(p); $('#grid').append(card);
  }
  if (!items.length) $('#grid').append(text('p', '这个分类暂时没有家具，换个分类看看。', 'empty'));
  $('#example-note').hidden = !catalog.products.some(p => p.visible && p.example);
  $('#owner-entry').textContent = mode ? '⌑ 家具管理' : '⌑ 老板登录';
}
function openDetail(p) {
  $('#detail-name').textContent = p.name; $('#detail-category').textContent = `${p.category} / 家具详情`; $('#detail-material').textContent = `材质：${p.material}`;
  $('#detail-description').textContent = p.description; setImage($('#detail-image'), p.images[0]); $('#detail-image').alt = p.name;
  $('#detail-dimensions').replaceChildren();
  for (const [label, value] of [['长',p.length],['宽',p.width],['高',p.height]]) { const d = text('div',''); d.append(text('strong', value), text('span', `${label} / 厘米`)); $('#detail-dimensions').append(d); }
  $('#detail-thumbs').replaceChildren();
  p.images.forEach((url, index) => { const b = text('button', '', index === 0 ? 'active' : ''); b.setAttribute('aria-label', `查看第 ${index + 1} 张图片`); b.append(imageNode(url,p.name)); b.onclick = () => { setImage($('#detail-image'), url); for (const t of $('#detail-thumbs').children) t.classList.remove('active'); b.classList.add('active'); }; $('#detail-thumbs').append(b); });
  $('#detail-example').textContent = p.example ? '图片为效果示意，款式、材质和尺寸以门店实物为准。' : '尺寸为人工测量，实际尺寸请以门店实物为准。';
  contact($('#detail-contact')); show('#detail');
}
async function refreshPublic(force = false) {
  if (mode || publicLoading || (!force && Date.now() - lastPublicFetch < 15000)) return;
  publicLoading = true; lastPublicFetch = Date.now(); $('#refresh-catalog').disabled = true;
  $('#load-status').textContent = '正在获取最新家具…';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 25000) : null;
  try {
    const response = await fetch(`data.json?t=${Date.now()}`, {cache:'no-store', ...(controller ? {signal:controller.signal} : {})});
    if (!response.ok) throw new Error();
    const latest = await response.json();
    const version = latest._publication?.version ?? 0;
    if (!latest.store || !Array.isArray(latest.products) || !Number.isSafeInteger(version) || latest.products.some(p => typeof p.visible !== 'boolean' || !Array.isArray(p.images) || p.images.some(url => !/^assets\/(?:[\w-]+\/)*[\w-]+\.(jpg|jpeg|png|webp)$/.test(url)))) throw new Error('网站资料格式异常，请联系网站维护。');
    if (version >= publicVersion) {
      const changed = version !== publicVersion; publicVersion = version;
      original = clone(latest);
      if (!mode) {
        catalog = latest; if (changed || !$('#grid').children.length) render();
        $('#load-status').textContent = '已载入店铺家具';
      }
    }
  } catch (e) {
    if (!mode) {
      if (!catalog) $('#grid').replaceChildren(text('p','家具加载失败，请点击“更新家具”重试。','empty'));
      $('#load-status').textContent = '网页资料加载失败。请检查网络后点击“更新家具”重试。';
    }
  }
  finally { if (timer !== null) clearTimeout(timer); publicLoading = false; $('#refresh-catalog').disabled = false; }
}
function openAdmin() {
  $('#admin-status').textContent = '保存后，店铺页面会在几分钟内更新。';
  renderAdmin(); show('#admin');
}
function renderAdmin() {
  $('#admin-list').replaceChildren();
  for (const p of catalog.products) {
    const row = text('div','','admin-row'); const info = text('div',''); info.append(text('h3', p.name), text('p', dimensions(p)), text('span', p.visible ? '展示中' : '已下架', 'tag'));
    const edit = text('button','编辑','secondary'); edit.onclick = () => openEditor(p);
    const toggle = text('button', p.visible ? '下架' : '重新展示','text-button');
    toggle.onclick = async () => { if (busy) return; setBusy(true); try { const next = clone(catalog); next.products.find(i=>i.id===p.id).visible = !p.visible; await persist(next); render(); renderAdmin(); toast('展示状态已保存，店铺页面正在更新。'); } catch(e) { toast(e.message); } finally { setBusy(false); } };
    row.append(imageNode(p.images[0],p.name),info,edit,toggle); $('#admin-list').append(row);
  }
  if (!catalog.products.length) $('#admin-list').append(text('p','还没有家具，点击“新增家具”上传第一件。','empty'));
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('#admin button,#editor button,#editor input,#editor select,#editor textarea,#store-editor button,#store-editor input,#store-editor textarea').forEach(n => n.disabled = value);
  $('#save-product').textContent = value ? '正在保存…' : '保存家具';
  $('#store-form .button').textContent = value ? '正在保存…' : '保存门店信息';
}
async function persist(next, uploads = []) {
  if (mode !== 'live') throw new Error('请先登录管理。');
  catalog = await manager.save(next, uploads);
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
  let bitmap, objectUrl;
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file);
    else { objectUrl = URL.createObjectURL(file); bitmap = await new Promise((resolve,reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('这张照片无法读取，请换一张 JPG 照片。')); image.src = objectUrl; }); }
    const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height)); const canvas=document.createElement('canvas'); canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale); const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let result=canvas.toDataURL('image/jpeg',.8); if(result.length>850000) result=canvas.toDataURL('image/jpeg',.55); if(result.length>1000000) throw new Error('图片仍然太大，请换一张或裁剪后上传。'); return result;
  } finally { if (bitmap && typeof bitmap.close === 'function') bitmap.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); }
}
$('#photo-input').onchange=async event=>{if(busy||processing)return;const files=Array.from(event.target.files);if(files.length+photos.length>5){$('#editor-error').textContent='每件家具最多 5 张照片，请先移除不需要的照片。';event.target.value='';return;} processing=true;setBusy(true);$('#save-product').textContent='照片处理中…';$('#editor-error').textContent='';try{for(const f of files)photos.push({url:await compress(f),pending:true});renderPhotos();}catch(e){$('#editor-error').textContent=e.message;}finally{processing=false;setBusy(false);event.target.value='';}};
$('#product-form').onsubmit=async event=>{
  event.preventDefault();if(busy||processing)return;$('#editor-error').textContent='';
  if(!photos.length){$('#editor-error').textContent='请至少添加一张家具照片。';return;}
  const f=event.target; const p={id:editId || newProductId(),name:f.elements.namedItem('name').value.trim(),category:f.elements.namedItem('category').value,material:f.elements.namedItem('material').value.trim(),description:f.elements.namedItem('description').value.trim(),images:[]};
  if(!p.name||!p.material||!p.description){$('#editor-error').textContent='名称、材质和介绍不能只填写空格。';return;}
  for(const key of ['length','width','height'])p[key]=Number(f.elements.namedItem(key).value);
  for(const key of ['visible','featured','example'])p[key]=f.elements.namedItem(key).checked;
  setBusy(true);
  try{
    for(const photo of photos){
      if(mode==='live'&&photo.pending) photo.path ||= 'assets/uploads/' + newProductId() + '.jpg';
      p.images.push(mode==='live'&&photo.pending ? photo.path : photo.url);
    }
    const next=clone(catalog);const index=next.products.findIndex(i=>i.id===p.id);if(index<0)next.products.push(p);else next.products[index]=p;
    const uploads = mode==='live' ? photos.filter(photo=>photo.pending).map(photo=>({path:photo.path,dataURL:photo.url,blobSha:photo.blobSha})) : [];
    try { await persist(next, uploads); } finally { for (const upload of uploads) { const photo=photos.find(p=>p.path===upload.path); if(photo)photo.blobSha=upload.blobSha; } }
    if(mode==='live')for(const photo of photos){if(photo.pending){previews.set(photo.path,photo.url);photo.url=photo.path;photo.pending=false;}}
    category = '全部'; render();renderAdmin();$('#editor').close();toast('保存成功，店铺页面正在更新。');
  }catch(e){$('#editor-error').textContent=e.message;}finally{setBusy(false);}
};
function forgetKey(){try{localStorage.removeItem(keyStorage);}catch{}}
$('#owner-entry').onclick=()=>{if(mode)openAdmin();else{try{const key=localStorage.getItem(keyStorage);if(key&&key.startsWith('github_pat_')){$('#token').value=key;$('#remember-key').checked=true;}}catch{}show('#login');}};
$('#login-form').onsubmit=async event=>{
  event.preventDefault(); const submit=$('button',event.target);submit.disabled=true;submit.textContent='正在登录…';$('#login-error').textContent='';
  try{
    const key=$('#token').value.trim();if($('#remember-key').checked&&!key.startsWith('github_pat_'))throw new Error('这个凭证不能被记住，请取消“记住登录”后继续。');
    const data=await manager.login(key);mode='live';catalog=data;previews.clear();imageRequests.clear();
    if($('#remember-key').checked){try{localStorage.setItem(keyStorage,key);}catch{toast('已登录，但浏览器未允许记住登录。');}}else forgetKey();
    $('#token').value='';$('#login').close();render();openAdmin();
  }catch(e){manager.logout();if(e.status===401)forgetKey();$('#login-error').textContent=e.message || '登录失败，请检查网络。';}finally{submit.disabled=false;submit.textContent='登录管理';}
};
function logout(){if(busy)return;mode=null;manager.logout();previews.clear();imageRequests.clear();forgetKey();$('#remember-key').checked=false;catalog=original?clone(original):null;$('#token').value='';document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(catalog)render();else $('#grid').replaceChildren(text('p','家具正在加载…','empty'));toast('已退出管理。保存的修改将在发布完成后显示。');refreshPublic(true);}
$('#logout').onclick=logout;
$('#add-product').onclick=()=>openEditor();
$('#store-edit').onclick=()=>{const f=$('#store-form');for(const key of ['intro','phone','address','hours'])f.elements.namedItem(key).value=catalog.store[key]||'';$('#store-error').textContent='';show('#store-editor');};
$('#store-form').onsubmit=async event=>{event.preventDefault();if(busy)return;setBusy(true);$('#store-error').textContent='';try{const next=clone(catalog);for(const key of ['intro','phone','address','hours'])next.store[key]=event.target.elements.namedItem(key).value.trim();if(!next.store.intro)throw new Error('请填写门店介绍。');if(next.store.phone&&!/^[+\d\s()-]{5,30}$/.test(next.store.phone))throw new Error('请填写有效的联系电话。');await persist(next);render();$('#store-editor').close();toast('门店信息已保存，店铺页面正在更新。');}catch(e){$('#store-error').textContent=e.message;}finally{setBusy(false);}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(!busy)b.closest('dialog').close();});
document.querySelectorAll('dialog').forEach(d=>{d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});});
$('#year').textContent=new Date().getFullYear();
$('#show-password').onchange=event=>$('#token').type=event.target.checked?'text':'password';
$('#refresh-catalog').onclick = () => refreshPublic(true);
window.addEventListener('online', () => refreshPublic(true));
window.addEventListener('focus', () => refreshPublic());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPublic(); });
setInterval(() => { if (!document.hidden) refreshPublic(); }, 60000);
async function initialiseCatalog() {
  $('#grid').replaceChildren(text('p','正在加载店内家具，请稍候…','empty'));
  $('#example-note').hidden = true;
  await refreshPublic(true);
}
initialiseCatalog();
