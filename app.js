/* 歪矯正: キャラクターアーカイブ＋Supabase管理者モード (静的サイト対応) */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const app = $('#app');
  const toastEl = $('#toast');
  const dialog = $('#login-dialog');
  const form = $('#login-form');
  const lightbox = $('#lightbox');
  const lightboxImage = $('#lightbox-img');
  const lightboxCaption = $('#lightbox-caption');
  const fileInput = $('#image-file-input');
  const config = window.SUPABASE_CONFIG || {};
  const configured = /^https:\/\/[^/]+\.supabase\.co\/?$/.test((config.url || '').trim()) &&
    typeof config.publishableKey === 'string' && !!config.publishableKey.trim();
  // 取り違えた秘密鍵をWebサイトへ公開してしまう事故を防止します。
  function unsafeKey(key) {
    if (/^sb_secret_/i.test(key)) return true;
    try {
      const payload = JSON.parse(atob(key.split('.')[1]));
      return payload.role === 'service_role';
    } catch { return false; }
  }
  const B = 'character-images';
  const PLACEHOLDER = 'assets/placeholder.svg';
  const state = {
    db: null, connected: false, admin: false, edit: false, busy: false, chars: [],
    search: '', current: null, imageIndex: 0, lightboxOpen: false, focusedBefore: null,
    uploadTarget: null, loadError: '',
  };
  const h = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
  const copyObject = value => JSON.parse(JSON.stringify(value));
  const isLocal = path => /^assets\/[a-zA-Z0-9_.-]+$/.test(path || '');
  const uuid = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const x = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;
  };
  const fromStore = () => state.db.storage.from(B);
  const escapeSrc = src => h(src || PLACEHOLDER);

  $('#site-brand').textContent = SITE_SETTINGS.siteName;
  $('#footer-brand').textContent = SITE_SETTINGS.siteName;
  document.title = `${SITE_SETTINGS.siteName} | CHARACTERS`;

  function message(text, error = false) {
    toastEl.textContent = text;
    toastEl.classList.toggle('is-error', !!error);
    toastEl.hidden = false;
    clearTimeout(message.timer);
    message.timer = setTimeout(() => { toastEl.hidden = true; }, 6500);
  }
  function errorText(err) { return err?.message || String(err || '原因不明のエラー'); }
  function routeSlug() {
    const match = location.hash.match(/^#\/character\/([^/]+)\/?$/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch { return null; }
  }
  function safeImage(item) { return item?.url || PLACEHOLDER; }
  function getLocalSamples() {
    return CHARACTERS.map(c => ({
      ...copyObject(c), slug: c.id, dbId: null, published: true,
      imageItems: c.images.map((img, i) => ({
        ...img, path: img.src, url: img.src, kind: i === 0 ? 'main' : 'gallery',
        dbImageId: null, order: i - 1,
      })),
    }));
  }
  async function signedUrl(path) {
    if (!path) return PLACEHOLDER;
    if (isLocal(path)) return path;
    const { data, error } = await fromStore().createSignedUrl(path, 60 * 60 * 12);
    if (error) { console.warn('Image permission or URL error:', error.message); return PLACEHOLDER; }
    return data.signedUrl;
  }
  function normalizeCharacter(c, images) {
    const p = c.profile && typeof c.profile === 'object' && !Array.isArray(c.profile) ? c.profile : {};
    return {
      dbId: c.id, slug: c.slug, id: c.slug, number: p.number || String(c.sort_order + 1).padStart(3, '0'),
      name: c.name, reading: c.name_reading || '', category: p.category || 'ORIGINAL CHARACTER',
      catchphrase: p.catchphrase || '', description: c.description || '',
      profile: Array.isArray(p.fields) ? p.fields : [], published: c.is_published,
      sortOrder: c.sort_order, mainPath: c.main_image_path,
      imageItems: [], extraImages: images,
    };
  }
  async function checkAdmin() {
    const { data: userResult } = await state.db.auth.getUser();
    if (!userResult?.user) return false;
    const { data, error } = await state.db.rpc('is_site_admin');
    if (error) { console.warn('Admin check failed:', error.message); return false; }
    return data === true;
  }
  async function loadCloud() {
    if (!state.connected) return;
    const [charResult, imageResult] = await Promise.all([
      state.db.from('characters').select('*').order('sort_order', { ascending: true }),
      state.db.from('character_images').select('*').order('sort_order', { ascending: true }),
    ]);
    if (charResult.error) throw charResult.error;
    if (imageResult.error) throw imageResult.error;
    const mapped = charResult.data.map(c => normalizeCharacter(c, imageResult.data.filter(i => i.character_id === c.id)));
    const paths = [...new Set(mapped.flatMap(c => [c.mainPath, ...c.extraImages.map(i => i.storage_path)]).filter(Boolean))];
    const urls = new Map(await Promise.all(paths.map(async path => [path, await signedUrl(path)])));
    for (const c of mapped) {
      c.imageItems = [
        ...(c.mainPath ? [{kind:'main', path:c.mainPath, url:urls.get(c.mainPath), title:'MAIN VISUAL', caption:'メインビジュアル', order:-1}] : []),
        ...c.extraImages.map((img,i) => ({
          kind:'gallery', dbImageId:img.id, path:img.storage_path,
          url:urls.get(img.storage_path), title:`GALLERY ${String(i + 1).padStart(2,'0')}`,
          caption:img.caption || '', order:img.sort_order,
        })),
      ];
    }
    state.chars = mapped;
    state.loadError = '';
  }
  async function refresh(showToast = false) {
    try {
      if (state.connected) await loadCloud();
      draw();
      if (showToast) message('保存しました。別の端末からも確認できます。');
    } catch (err) {
      console.error(err);
      state.loadError = errorText(err);
      draw();
    }
  }
  function draw() {
    $('#header-count').textContent = `${String(state.chars.length).padStart(2,'0')} FILES`;
    const nav = $('#admin-nav-button');
    nav.textContent = state.admin ? (state.edit ? '編集を終了' : '編集モード') : '管理者ログイン';
    let logout = $('#logout-button');
    if (state.admin && !logout) {
      logout = document.createElement('button'); logout.id = 'logout-button'; logout.className = 'admin-nav-button muted';
      logout.type = 'button'; logout.textContent = 'ログアウト'; nav.insertAdjacentElement('afterend', logout);
      logout.addEventListener('click', logoutAction);
    }
    if (logout) logout.hidden = !state.admin;
    let status = $('#connection-status');
    if (!status) { status = document.createElement('div'); status.id='connection-status'; status.className='connection-status'; app.before(status); }
    status.textContent = !configured ? 'デモ表示中：config.jsにSupabaseの接続情報を入力するとクラウド編集を使えます。'
      : !state.connected ? 'Supabaseに接続できません。config.jsと通信状態をご確認ください。'
      : state.edit ? '● 管理者編集モード：変更内容を保存すると公開サイトに反映されます。' : '';
    status.hidden = !status.textContent;
    if (state.loadError) {
      app.innerHTML = `<section class="error-panel"><h1>データを読み込めませんでした</h1><p>${h(state.loadError)}</p><button class="action-primary" type="button" id="retry-load">再読み込み</button></section>`;
      $('#retry-load').addEventListener('click', () => state.connected ? refresh() : location.reload());
      return;
    }
    const slug = routeSlug();
    const character = state.chars.find(c => c.slug === slug);
    $('#index-link').classList.toggle('nav-active', !character);
    closeLightbox();
    if (character) renderCharacter(character); else renderIndex();
  }
  function renderIndex() {
    state.current = null;
    document.title = `${SITE_SETTINGS.siteName} | CHARACTERS`;
    const editActions = state.admin && state.edit ? `<div class="editor-bar"><button id="add-character" type="button" class="action-primary">＋ 新しいキャラを追加</button>${state.chars.length===0 ? '<button id="seed-characters" type="button" class="action-secondary">仮キャラ6人を登録</button>' : ''}<button id="backup-json" type="button" class="action-secondary">情報をJSONで保存</button></div>` : '';
    app.innerHTML = `
      <section class="index-heading"><div class="eyebrow"><span class="eyebrow-line"></span> OFFICIAL CHARACTER INDEX <span class="eyebrow-number">/ 001</span></div>
        <div class="title-row"><h1>${h(SITE_SETTINGS.headline)}<span class="title-period">.</span></h1><span class="title-deco" aria-hidden="true">✳</span></div>
        <div class="index-bottom"><div><p class="subtitle">${h(SITE_SETTINGS.subtitle)}</p><p class="intro">${h(SITE_SETTINGS.introduction)}</p></div><span class="section-count">${String(state.chars.length).padStart(2,'0')} / CHARACTERS</span></div></section>
      <section class="index-content"><div class="section-toolbar"><div class="section-name"><span class="section-icon">✳</span> ALL CHARACTERS</div>
        <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input id="character-search" type="search" placeholder="名前で検索" aria-label="キャラクターを名前で検索" value="${h(state.search)}" /></label></div>
        ${editActions}<div id="character-grid" class="character-grid"></div><p id="empty-message" class="empty-message" hidden>該当するキャラクターは見つかりませんでした。</p></section>`;
    $('#character-search').addEventListener('input', e => { state.search = e.target.value; populateCards(); });
    if ($('#add-character')) $('#add-character').addEventListener('click', createCharacter);
    if ($('#seed-characters')) $('#seed-characters').addEventListener('click', importSamples);
    if ($('#backup-json')) $('#backup-json').addEventListener('click', downloadBackup);
    populateCards();
  }
  function populateCards() {
    const q = state.search.trim().toLocaleLowerCase('ja-JP');
    const filtered = state.chars.filter(c => `${c.name} ${c.reading} ${c.number}`.toLocaleLowerCase('ja-JP').includes(q));
    $('#character-grid').innerHTML = filtered.map(c => `<a class="character-card" href="#/character/${encodeURIComponent(c.slug)}" aria-label="${h(c.name)}の紹介ページへ">
      <div class="character-card-image"><img src="${escapeSrc(safeImage(c.imageItems[0]))}" alt="${h(c.name)}のメイン画像" loading="lazy"/><span class="card-number">NO. ${h(c.number)}</span>${state.admin&&!c.published?'<span class="draft-tag">非公開</span>':''}<span class="card-view" aria-hidden="true">↗</span></div>
      <div class="card-text"><div><h2>${h(c.name)}</h2><span>${h(c.reading || 'CHARACTER PROFILE')}</span></div><span class="card-arrow">→</span></div></a>`).join('');
    $('#empty-message').hidden = filtered.length !== 0;
    if (!filtered.length) $('#empty-message').textContent = state.connected ? '公開中のキャラクターはまだありません。管理者としてログインすると追加できます。' : '該当するキャラクターは見つかりませんでした。';
  }
  function profileEditFields(c) {
    return (c.profile || []).map(field => `<div class="edit-profile-row"><input aria-label="項目名" class="field-label" maxlength="60" value="${h(field.label)}"/><input aria-label="内容" class="field-value" maxlength="500" value="${h(field.value)}"/><button class="remove-field" type="button" aria-label="この項目を削除">×</button></div>`).join('');
  }
  function renderCharacter(c) {
    state.current = c;
    state.imageIndex = 0;
    document.title = `${c.name} | ${SITE_SETTINGS.siteName}`;
    const editing = state.admin && state.edit;
    const fields = (c.profile || []).map(field => `<div class="profile-row"><dt>${h(field.label)}</dt><dd>${h(field.value)}</dd></div>`).join('');
    const textSection = editing ? `
      <form id="character-edit-form" class="character-edit-form">
        <label>名前<input name="name" value="${h(c.name)}" required maxlength="120" /></label>
        <label>ふりがな<input name="reading" value="${h(c.reading)}" maxlength="120" /></label>
        <label>分類<input name="category" value="${h(c.category)}" maxlength="120" /></label>
        <label>キャッチコピー<input name="catchphrase" value="${h(c.catchphrase)}" maxlength="300" /></label>
        <label>紹介文<textarea name="description" rows="7" maxlength="20000">${h(c.description)}</textarea></label>
        <div class="profile-title">BASIC INFORMATION <span>↘</span></div><div id="editor-fields">${profileEditFields(c)}</div>
        <button type="button" id="add-field" class="action-secondary">＋ プロフィール項目を追加</button>
        <label class="publish-check"><input type="checkbox" name="published" ${c.published?'checked':''}/> このキャラを一般公開する</label>
        <div class="editor-actions"><button class="action-primary" type="submit">変更を保存</button><button id="delete-character" class="action-danger" type="button">キャラを削除</button></div>
      </form>` : `
        <div class="detail-name-wrap"><p class="detail-kicker">CHARACTER PROFILE</p><h1>${h(c.name)}</h1>${c.reading?`<p class="reading">${h(c.reading)}</p>`:''}</div>
        <div class="description-block"><p class="catchphrase">${h(c.catchphrase)}</p><p class="description">${h(c.description)}</p></div>
        <div class="profile-table"><div class="profile-title">BASIC INFORMATION <span>↘</span></div><dl>${fields}</dl></div>`;
    const editMain = editing ? `<div class="image-edit-row"><button id="main-replace" class="action-primary" type="button">画像をタップして差し替え</button><button id="main-zoom" class="action-secondary" type="button">拡大</button></div>` : '';
    app.innerHTML = `
      <section class="detail-top"><a class="back-link" href="#/"><span>←</span> BACK TO CHARACTERS</a><span class="detail-file">CHARACTER FILE <span class="file-num">/ ${h(c.number)}</span></span></section>
      <section class="detail-main"><div class="detail-art"><div class="main-art-frame"><button id="main-image-button" type="button" class="main-image-button" aria-label="${editing?'画像を変更':'現在の画像を拡大表示'}"><img id="detail-main-img" src="${escapeSrc(safeImage(c.imageItems[0]))}" alt="${h(c.name)}の画像" /><span class="zoom-hint">${editing?'↗ TAP TO REPLACE':'↗ CLICK TO ENLARGE'}</span></button></div>${editMain}<span class="art-corner-label">© ORIGINAL CHARACTER ARCHIVE</span></div>
        <div class="detail-info"><div class="detail-info-top"><span class="character-tag"><span class="tag-dot"></span> ${h(c.category)}</span><span class="detail-number">NO. ${h(c.number)} ${state.admin&&!c.published?' / 非公開':''}</span></div>${textSection}</div></section>
      <section class="gallery-section" aria-label="画像ギャラリー"><div class="gallery-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> ADDITIONAL VISUALS</div><h2>GALLERY<span class="title-period">.</span></h2></div><p>${editing?'画像の差し替え・削除や並び替えができます。':'画像を選択して切り替えられます。'}<br/>拡大表示では左右の画像へ移動できます。</p></div>
        <div class="gallery-toolbar"><div><span id="gallery-current">${c.imageItems.length?'01':'00'}</span> <span class="gallery-slash">/</span> ${String(c.imageItems.length).padStart(2,'0')}</div><div class="gallery-buttons"><button id="gallery-prev" type="button" aria-label="前の画像">←</button><button id="gallery-next" type="button" aria-label="次の画像">→</button></div></div>
        ${editing?'<div class="editor-bar"><button id="gallery-add" class="action-primary" type="button">＋ 画像を追加</button></div>':''}<div id="gallery-thumbs" class="gallery-thumbs"></div></section>
      <div class="bottom-navigation"><a href="#/">← RETURN TO ALL CHARACTERS</a><span>END OF FILE ${h(c.number)}</span></div>`;
    const mainAction = () => {
      if (!editing) return openLightbox();
      const shown = c.imageItems[state.imageIndex];
      chooseFile(shown?.kind === 'gallery' ? {kind:'replace', character:c, image:shown} : {kind:'main',character:c});
    };
    $('#main-image-button').addEventListener('click', mainAction);
    if ($('#main-replace')) $('#main-replace').addEventListener('click', mainAction);
    if ($('#main-zoom')) $('#main-zoom').addEventListener('click', openLightbox);
    $('#gallery-prev').addEventListener('click', () => showImage(state.imageIndex-1));
    $('#gallery-next').addEventListener('click', () => showImage(state.imageIndex+1));
    if ($('#gallery-add')) $('#gallery-add').addEventListener('click', () => chooseFile({kind:'add', character:c}));
    if (editing) {
      $('#character-edit-form').addEventListener('submit', saveCharacter);
      $('#delete-character').addEventListener('click', () => deleteCharacter(c));
      $('#add-field').addEventListener('click', () => $('#editor-fields').insertAdjacentHTML('beforeend', '<div class="edit-profile-row"><input class="field-label" aria-label="項目名" placeholder="項目名" maxlength="60"/><input class="field-value" aria-label="内容" placeholder="内容" maxlength="500"/><button class="remove-field" type="button">×</button></div>'));
      $('#editor-fields').addEventListener('click', event => { if(event.target.closest('.remove-field')) event.target.closest('.edit-profile-row').remove(); });
    }
    renderGalleryThumbs(c, editing);
  }
  function renderGalleryThumbs(c, editing) {
    $('#gallery-thumbs').innerHTML = c.imageItems.map((img,i) => `<div class="gallery-item">
      <button class="gallery-thumb ${i===state.imageIndex?'selected':''}" type="button" data-image-index="${i}" aria-pressed="${i===state.imageIndex}"><span class="thumb-visual"><img src="${escapeSrc(img.url)}" alt="" loading="lazy"/></span><span class="thumb-bottom"><span><small>${h(img.title || 'IMAGE')}</small><strong>${h(img.caption)}</strong></span><span class="thumb-index">${String(i+1).padStart(2,'0')}</span></span></button>
      ${editing ? `<div class="gallery-edit-controls"><button type="button" data-replace="${i}">差し替え</button>${img.kind==='gallery'?`<button type="button" data-move="up:${i}" ${i<=1?'disabled':''} aria-label="上へ移動">↑</button><button type="button" data-move="down:${i}" ${i===c.imageItems.length-1?'disabled':''} aria-label="下へ移動">↓</button><button type="button" data-delete="${i}" class="delete-image">削除</button><label>説明<input type="text" data-caption="${i}" value="${h(img.caption)}" maxlength="200" /></label>`:''}</div>` : ''}
      </div>`).join('');
    $('#gallery-thumbs').addEventListener('click', event => {
      const rep = event.target.closest('[data-replace]');
      if (rep) return chooseFile({kind:'replace',character:c,image:c.imageItems[Number(rep.dataset.replace)]});
      const del = event.target.closest('[data-delete]');
      if (del) return deleteGalleryImage(c.imageItems[Number(del.dataset.delete)]);
      const mov = event.target.closest('[data-move]');
      if (mov) { const [dir,idx] = mov.dataset.move.split(':'); return moveImage(Number(idx),dir); }
      const thumb = event.target.closest('[data-image-index]');
      if (thumb) showImage(Number(thumb.dataset.imageIndex));
    });
    $('#gallery-thumbs').addEventListener('change', event => {
      const input = event.target.closest('[data-caption]');
      if (!input) return;
      const img = c.imageItems[Number(input.dataset.caption)];
      if (img?.dbImageId) saveCaption(img.dbImageId, input.value);
    });
  }
  function showImage(index) {
    const c = state.current;
    if (!c || !c.imageItems.length) return;
    state.imageIndex = (index+c.imageItems.length)%c.imageItems.length;
    const item = c.imageItems[state.imageIndex];
    $('#detail-main-img').src = safeImage(item);
    $('#detail-main-img').alt = `${c.name}：${item.caption || '画像'}`;
    $('#gallery-current').textContent = String(state.imageIndex+1).padStart(2,'0');
    $$('.gallery-thumb').forEach((el,i) => {
      el.classList.toggle('selected', i===state.imageIndex);
      el.setAttribute('aria-pressed',String(i===state.imageIndex));
    });
    if (state.lightboxOpen) updateLightbox();
  }
  function updateLightbox() {
    const c = state.current, item = c?.imageItems[state.imageIndex];
    if (!item) return;
    lightboxImage.src = safeImage(item);
    lightboxImage.alt = `${c.name}：${item.caption || '画像'}`;
    lightboxCaption.textContent = `${c.name} / ${item.caption || item.title || '画像'} (${state.imageIndex+1}/${c.imageItems.length})`;
  }
  function openLightbox() {
    if (!state.current?.imageItems.length) { message('まだ画像が登録されていません。'); return; }
    state.focusedBefore = document.activeElement;
    state.lightboxOpen = true; lightbox.hidden = false; lightbox.setAttribute('aria-hidden','false');
    document.body.classList.add('is-lightbox-open'); updateLightbox(); $('#lightbox-close').focus();
  }
  function closeLightbox() {
    if (!state.lightboxOpen) return;
    state.lightboxOpen = false; lightbox.hidden = true; lightbox.setAttribute('aria-hidden','true');
    document.body.classList.remove('is-lightbox-open');
    if (state.focusedBefore?.isConnected) state.focusedBefore.focus();
  }
  $('#lightbox-close').addEventListener('click', closeLightbox);
  $('#lightbox-prev').addEventListener('click', () => showImage(state.imageIndex-1));
  $('#lightbox-next').addEventListener('click', () => showImage(state.imageIndex+1));
  lightbox.addEventListener('click', e => { if (e.target===lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (!state.lightboxOpen) return;
    if (e.key==='Escape') { e.preventDefault(); closeLightbox(); }
    if (e.key==='ArrowLeft') { e.preventDefault(); showImage(state.imageIndex-1); }
    if (e.key==='ArrowRight') { e.preventDefault(); showImage(state.imageIndex+1); }
  });
  $('#admin-nav-button').addEventListener('click', () => {
    if (!state.admin) {
      if (!state.connected) { message('先にconfig.jsにSupabase接続情報を設定してください。',true); return; }
      $('#login-error').textContent = ''; dialog.showModal(); return;
    }
    state.edit = !state.edit; draw(); message(state.edit ? '編集モードに切り替えました。' : '閲覧モードに戻りました。');
  });
  $('#login-close').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const btn = $('#login-submit'); btn.disabled = true; $('#login-error').textContent = '';
    try {
      const { error } = await state.db.auth.signInWithPassword({ email:$('#login-email').value.trim(), password:$('#login-password').value });
      if (error) throw error;
      const admin = await checkAdmin();
      if (!admin) {
        await state.db.auth.signOut();
        throw Error('管理者として登録されたアカウントではありません。');
      }
      state.admin = true; state.edit = true;
      $('#login-password').value = ''; dialog.close();
      await refresh(); message('管理者としてログインしました。');
    } catch (err) { $('#login-error').textContent = errorText(err); }
    finally { btn.disabled = false; }
  });
  async function logoutAction() {
    if (!state.connected) return;
    await state.db.auth.signOut(); state.admin = false; state.edit = false;
    await refresh(); message('ログアウトしました。');
  }
  async function mutation(fn, successMessage) {
    if (!state.admin || !state.connected) return message('管理者ログインが必要です。', true);
    if (state.busy) return;
    state.busy = true;
    try { await fn(); await refresh(); message(successMessage || '保存しました。'); }
    catch (err) { console.error(err); message('保存できませんでした：'+errorText(err),true); }
    finally { state.busy = false; }
  }
  function saveCharacter(event) {
    event.preventDefault();
    const c = state.current, f = event.currentTarget;
    const data = new FormData(f);
    const name = String(data.get('name')||'').trim();
    if (!name) return message('名前を入力してください。', true);
    const fields = $$('.edit-profile-row',f).map(row => ({
      label:$('.field-label',row).value.trim(), value:$('.field-value',row).value.trim()
    })).filter(row => row.label || row.value);
    mutation(async () => {
      const values = {
        name, name_reading:String(data.get('reading')||''), description:String(data.get('description')||''),
        is_published:data.get('published')==='on',
        profile:{ number:c.number, category:String(data.get('category')||'ORIGINAL CHARACTER'), catchphrase:String(data.get('catchphrase')||''), fields },
      };
      const {data:rows,error} = await state.db.from('characters').update(values).eq('id',c.dbId).select('id').single();
      if (error || !rows) throw error || Error('保存対象が見つかりません。');
    },'文章と公開設定を保存しました。');
  }
  async function createCharacter() {
    if (state.busy) return;
    const name = prompt('新しいキャラクターの名前を入力してください。');
    if (name === null) return;
    if (!name.trim()) { message('名前を入力してください。',true); return; }
    const slug = `character-${uuid()}`;
    await mutation(async () => {
      const {data,error} = await state.db.from('characters').insert({
        slug, name:name.trim().slice(0,120), description:'', is_published:false,
        sort_order:state.chars.length, profile:{number:String(state.chars.length+1).padStart(3,'0'),category:'ORIGINAL CHARACTER',catchphrase:'',fields:[]},
      }).select('id').single();
      if (error || !data) throw error || Error('作成できませんでした。');
    },'非公開キャラクターを新規登録しました。');
    if (state.chars.some(c => c.slug === slug)) location.hash = `#/character/${slug}`;
  }
  async function deleteCharacter(c) {
    if (!confirm(`「${c.name}」を削除しますか？\nプロフィールと画像の参照が削除されます。この操作は元に戻せません。`)) return;
    await mutation(async () => {
      const paths = [c.mainPath,...c.extraImages.map(i=>i.storage_path)].filter(p => p && !isLocal(p));
      const {error} = await state.db.from('characters').delete().eq('id',c.dbId);
      if (error) throw error;
      if (paths.length) { const result=await fromStore().remove(paths); if(result.error) console.warn('Storage cleanup:',result.error.message); }
      location.hash = '#/';
    },'キャラクターを削除しました。');
  }
  function chooseFile(target) {
    if (!state.admin || !state.edit || !state.connected) return;
    state.uploadTarget = target; fileInput.value = ''; fileInput.click();
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0], target = state.uploadTarget;
    if (!file || !target) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return message('JPG・PNG・WebPのみ登録できます。',true);
    if (file.size > 5*1024*1024) return message('画像は1枚5MB以下にしてください。',true);
    const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
    const path = `characters/${target.character.dbId}/${uuid()}.${ext}`;
    await mutation(async () => {
      const up = await fromStore().upload(path, file, {contentType:file.type, cacheControl:'3600', upsert:false});
      if (up.error) throw up.error;
      try {
        if (target.kind==='main' || target.image?.kind==='main') {
          const {error} = await state.db.from('characters').update({main_image_path:path}).eq('id',target.character.dbId);
          if (error) throw error;
        } else if (target.kind==='replace') {
          const {error} = await state.db.from('character_images').update({storage_path:path}).eq('id',target.image.dbImageId);
          if (error) throw error;
        } else {
          const order = Math.max(-1,...target.character.extraImages.map(i=>i.sort_order)) + 1;
          const {error} = await state.db.from('character_images').insert({character_id:target.character.dbId, storage_path:path, caption:file.name.slice(0,200), sort_order:order});
          if (error) throw error;
        }
      } catch (err) { await fromStore().remove([path]); throw err; }
      const oldPath = target.kind==='main' ? target.character.mainPath : target.image?.path;
      if (oldPath && !isLocal(oldPath) && oldPath!==path) {
        const clean = await fromStore().remove([oldPath]);
        if (clean.error) console.warn('Could not clean old image:',clean.error.message);
      }
    },'画像をアップロードしました。');
  });
  function deleteGalleryImage(img) {
    if (!img?.dbImageId || !confirm('このギャラリー画像を削除しますか？')) return;
    mutation(async () => {
      const {error} = await state.db.from('character_images').delete().eq('id',img.dbImageId);
      if (error) throw error;
      if (img.path && !isLocal(img.path)) {
        const clean = await fromStore().remove([img.path]); if(clean.error) console.warn('Cleanup:',clean.error.message);
      }
    },'画像を削除しました。');
  }
  function saveCaption(imageId, caption) {
    mutation(async () => {
      const {error} = await state.db.from('character_images').update({caption}).eq('id',imageId);
      if (error) throw error;
    },'画像の説明を保存しました。');
  }
  function moveImage(index,dir) {
    const c=state.current;
    const gallery=c.imageItems.filter(i=>i.kind==='gallery');
    const item=c.imageItems[index];
    const pos=gallery.findIndex(i=>i.dbImageId===item?.dbImageId);
    const dest=dir==='up'?pos-1:pos+1;
    if (pos<0 || dest<0 || dest>=gallery.length) return;
    const other=gallery[dest];
    mutation(async () => {
      // sort_orderはインデックスそのものに整列し、重複があっても確実に入れ替えます。
      const reordered=gallery.slice(); [reordered[pos],reordered[dest]]=[reordered[dest],reordered[pos]];
      for (let i=0;i<reordered.length;i++) {
        const {error}=await state.db.from('character_images').update({sort_order:i}).eq('id',reordered[i].dbImageId);
        if (error) throw error;
      }
    },'画像の順番を変更しました。');
  }
  async function importSamples() {
    if (!state.admin || state.chars.length || !confirm('仮キャラクター6人をクラウドに登録しますか？\n画像はassets内のサンプルを参照します。')) return;
    await mutation(async () => {
      for (let i=0;i<CHARACTERS.length;i++) {
        const c=CHARACTERS[i];
        const {data,error} = await state.db.from('characters').insert({
          slug:c.id, name:c.name, name_reading:c.reading||'', description:c.description,
          main_image_path:c.images[0]?.src||null, is_published:true, sort_order:i,
          profile:{ number:c.number, category:c.category, catchphrase:c.catchphrase, fields:c.profile },
        }).select('id').single();
        if (error) throw error;
        if (c.images.length>1) {
          const rows=c.images.slice(1).map((img,j) => ({character_id:data.id,storage_path:img.src, caption:img.caption||'',sort_order:j}));
          const {error:imgError} = await state.db.from('character_images').insert(rows);
          if (imgError) throw imgError;
        }
      }
    },'サンプル6人を登録しました。');
  }
  function downloadBackup() {
    const data = state.chars.map(c => ({name:c.name,slug:c.slug,description:c.description,reading:c.reading,category:c.category,catchphrase:c.catchphrase,profile:c.profile,published:c.published,mainPath:c.mainPath,gallery:c.extraImages?.map(i=>({path:i.storage_path,caption:i.caption,sortOrder:i.sort_order}))||[]}));
    const blob = new Blob([JSON.stringify({exportedAt:new Date().toISOString(),characters:data},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download=`hizumi-kyosei-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('文章・設定のJSONを保存しました。画像そのものは含まれません。');
  }
  window.addEventListener('hashchange', () => { state.imageIndex=0; draw(); window.scrollTo(0,0); });
  async function loadSupabaseSDK() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(Error('SupabaseのJavaScriptを読み込めませんでした。ネット接続を確認してください。'));
      document.head.append(script);
    });
  }
  async function init() {
    state.chars = getLocalSamples();
    if (!configured) { draw(); return; }
    if (unsafeKey(config.publishableKey.trim())) {
      state.loadError = '危険な秘密鍵がconfig.jsに設定されています。公開可能なPublishable / anon keyに置き換えてください。';
      draw(); return;
    }
    try { await loadSupabaseSDK(); } catch (err) { state.loadError=errorText(err); draw(); return; }
    state.db = window.supabase.createClient(config.url.trim(),config.publishableKey.trim());
    state.connected = true;
    try {
      state.admin = await checkAdmin();
      await loadCloud();
      draw();
    } catch (err) {
      state.loadError=errorText(err); draw();
    }
  }
  init();
})();
