/* 歪矯正 ver.0.7: キャラクターと事件の相互参照・時系列事件記録 */
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
    incidents: [], incidentPeople: [], incidentError: '', incidentSearch: '', incidentSort: 'asc', incidentTab: 'overview',
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
  function currentRoute() {
    const path = location.hash || '#/';
    if (path === '#/incidents' || path === '#/incidents/') return {type:'incidents'};
    const match = path.match(/^#\/incident\/([^/]+)\/?$/);
    if (match) {
      try { return {type:'incident',slug:decodeURIComponent(match[1])}; }
      catch { return {type:'not-found'}; }
    }
    if (path.startsWith('#/character/')) return {type:'character',slug:routeSlug()};
    return {type:'characters'};
  }
  function sortedIncidents(items) {
    const dir = state.incidentSort === 'desc' ? -1 : 1;
    return [...items].sort((a,b) => {
      if (a.sortYear == null && b.sortYear == null) return a.name.localeCompare(b.name,'ja');
      if (a.sortYear == null) return 1;
      if (b.sortYear == null) return -1;
      return (a.sortYear - b.sortYear)*dir || a.name.localeCompare(b.name,'ja');
    });
  }
  function normalizeIncident(i) {
    return {
      dbId:i.id, slug:i.slug, name:i.name, occurredLabel:i.occurred_label || '年代未設定',
      sortYear:i.sort_year, place:i.place || '', overview:i.overview || '',
      damage:i.damage || '', published:i.is_published,
    };
  }
  async function loadIncidents() {
    const [events,people] = await Promise.all([
      state.db.from('incidents').select('*'),
      state.db.from('incident_people').select('*'),
    ]);
    if (events.error || people.error) {
      state.incidentError = errorText(events.error || people.error);
      state.incidents = []; state.incidentPeople = [];
      console.warn('Incident tables are not ready:',state.incidentError);
      return;
    }
    state.incidents = events.data.map(normalizeIncident);
    state.incidentPeople = people.data || [];
    state.incidentError = '';
  }
  function safeImage(item) { return item?.url || PLACEHOLDER; }
  function affiliationOf(c) { return (c.affiliation || '').trim() || '所属未設定'; }
  function fallbackAffiliation(category) {
    return category && category !== 'ORIGINAL CHARACTER' ? category : '所属未設定';
  }
  function mainVisual(c) {
    return c.imageItems?.find(img => img.kind === 'main')?.url || c.mainUrl || PLACEHOLDER;
  }
  function cardVisual(c) { return c.thumbnailPath ? (c.thumbnailUrl || PLACEHOLDER) : mainVisual(c); }

  function getLocalSamples() {
    return CHARACTERS.map(c => ({
      ...copyObject(c), slug: c.id, dbId: null, published: true,
      affiliation: c.affiliation || fallbackAffiliation(c.category),
      thumbnailPath: c.thumbnailSrc || null, thumbnailUrl: c.thumbnailSrc || c.images[0]?.src || PLACEHOLDER,
      mainUrl: c.images[0]?.src || PLACEHOLDER, rawProfile: {},
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
      affiliation: p.affiliation === undefined ? fallbackAffiliation(p.category) : p.affiliation,
      thumbnailPath: p.thumbnailPath || null, thumbnailUrl: null, mainUrl: null, rawProfile: copyObject(p),
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
    const paths = [...new Set(mapped.flatMap(c => [c.mainPath, c.thumbnailPath, ...c.extraImages.map(i => i.storage_path)]).filter(Boolean))];
    const urls = new Map(await Promise.all(paths.map(async path => [path, await signedUrl(path)])));
    for (const c of mapped) {
      c.mainUrl = c.mainPath ? urls.get(c.mainPath) || PLACEHOLDER : PLACEHOLDER;
      c.thumbnailUrl = c.thumbnailPath ? urls.get(c.thumbnailPath) || PLACEHOLDER : c.mainUrl;
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
    await loadIncidents();
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
    const incidentPage = ['incidents','incident'].includes(currentRoute().type);
    $('#header-count').textContent = incidentPage ? `${String(state.incidents.length).padStart(2,'0')} INCIDENTS` : `${String(state.chars.length).padStart(2,'0')} FILES`;
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
    const route = currentRoute();
    $('#index-link').classList.toggle('nav-active', route.type === 'characters' || route.type === 'character');
    $('#incidents-link').classList.toggle('nav-active', route.type === 'incidents' || route.type === 'incident');
    closeLightbox();
    if (route.type === 'characters') renderIndex();
    else if (route.type === 'character' && character) renderCharacter(character);
    else if (route.type === 'incidents') renderIncidents();
    else if (route.type === 'incident') {
      const incident = state.incidents.find(i => i.slug === route.slug);
      if (incident) renderIncident(incident); else renderNotFound('事件が見つかりませんでした。','#/incidents');
    } else renderNotFound('ページが見つかりませんでした。','#/');
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
        ${editActions}<div id="character-groups" class="character-groups"></div><p id="empty-message" class="empty-message" hidden>該当するキャラクターは見つかりませんでした。</p></section>`;
    $('#character-search').addEventListener('input', e => { state.search = e.target.value; populateCards(); });
    if ($('#add-character')) $('#add-character').addEventListener('click', createCharacter);
    if ($('#seed-characters')) $('#seed-characters').addEventListener('click', importSamples);
    if ($('#backup-json')) $('#backup-json').addEventListener('click', downloadBackup);
    populateCards();
  }
  function populateCards() {
    const q = state.search.trim().toLocaleLowerCase('ja-JP');
    const filtered = state.chars.filter(c =>
      `${c.name} ${c.reading} ${c.number} ${affiliationOf(c)}`.toLocaleLowerCase('ja-JP').includes(q));
    // グループの順番は、元のキャラ登録順の「最初に出現した所属」の順番です。
    // 番号の変更では表示順が勝手に変わらないようにします。
    const groups = new Map();
    for (const c of filtered) {
      const affiliation = affiliationOf(c);
      if (!groups.has(affiliation)) groups.set(affiliation, []);
      groups.get(affiliation).push(c);
    }
    $('#character-groups').innerHTML = [...groups].map(([affiliation, members]) => `
      <section class="affiliation-group" aria-label="所属：${h(affiliation)}">
        <div class="affiliation-heading"><div class="affiliation-heading-title"><span class="affiliation-mark">✳</span><h2>${h(affiliation)}</h2></div><span class="affiliation-count">${String(members.length).padStart(2,'0')} CHARACTERS</span></div>
        <div class="character-grid">${members.map(c => `<a class="character-card" href="#/character/${encodeURIComponent(c.slug)}" aria-label="${h(c.name)}の紹介ページへ">
          <div class="character-card-image"><img src="${escapeSrc(cardVisual(c))}" alt="${h(c.name)}のサムネイル画像" loading="lazy"/><span class="card-number">NO. ${h(c.number)}</span>${state.admin&&!c.published?'<span class="draft-tag">非公開</span>':''}<span class="card-view" aria-hidden="true">↗</span></div>
          <div class="card-text"><div><h3>${h(c.name)}</h3><span>${h(c.reading || 'CHARACTER PROFILE')}</span></div><span class="card-arrow">→</span></div></a>`).join('')}</div>
      </section>`).join('');
    $('#empty-message').hidden = filtered.length !== 0;
    if (!filtered.length) $('#empty-message').textContent = state.search ? '検索条件に合うキャラクターは見つかりませんでした。' : (state.connected ? '公開中のキャラクターはまだありません。管理者としてログインすると追加できます。' : '該当するキャラクターは見つかりませんでした。');
  }
  /* INCIDENT ARCHIVES / 事件関連 */
  function renderNotFound(text,link) {
    state.current = null;
    app.innerHTML = `<section class="error-panel"><h1>${h(text)}</h1><p>非公開、または削除された記録の可能性があります。</p><a class="action-secondary incident-inline-link" href="${h(link)}">一覧に戻る →</a></section>`;
  }
  function incidentTableAlert() {
    if (!state.incidentError) return '';
    return `<div class="incident-setup-alert" role="status"><strong>事件記録の準備が必要です</strong><p>サイトのファイル更新とは別に、SupabaseのSQL Editorで <code>STEP_12_INCIDENTS_SQL.sql</code> を一度実行してください。その後、この画面を再読み込みしてください。</p><small>接続結果：${h(state.incidentError)}</small></div>`;
  }
  function incidentCard(i) {
    return `<a class="incident-card" href="#/incident/${encodeURIComponent(i.slug)}" aria-label="${h(i.name)}の詳細を開く">
      <span class="incident-card-date">${h(i.occurredLabel)}</span>
      <span class="incident-card-content"><strong>${h(i.name)}</strong><small><span aria-hidden="true">⌖</span> ${h(i.place || '場所未設定')}</small></span>
      ${state.admin && !i.published ? '<span class="incident-draft">非公開</span>' : ''}
      <span class="incident-card-arrow" aria-hidden="true">↗</span>
    </a>`;
  }
  function renderIncidents() {
    state.current = null;
    document.title = `事件記録 | ${SITE_SETTINGS.siteName}`;
    const editing = state.admin && state.edit;
    app.innerHTML = `<section class="index-heading incident-index-heading">
      <div class="eyebrow"><span class="eyebrow-line"></span> INCIDENT ARCHIVES <span class="eyebrow-number">/ 002</span></div>
      <div class="title-row"><h1>INCIDENTS<span class="title-period">.</span></h1><span class="title-deco" aria-hidden="true">✳</span></div>
      <div class="index-bottom"><div><p class="subtitle">事件記録</p><p class="intro">時の流れに刻まれた出来事の記録。事件名を選択すると、その経緯や被害、関係者を確認できます。</p></div><span class="section-count">${String(state.incidents.length).padStart(2,'0')} / INCIDENTS</span></div>
    </section>
    <section class="index-content incident-index-content">
      <div class="section-toolbar"><div class="section-name"><span class="section-icon">✳</span> CHRONOLOGICAL RECORDS</div>
        <div class="incident-list-tools"><label class="search-box"><span aria-hidden="true">⌕</span><input id="incident-search" type="search" placeholder="事件名・年代・場所で検索" aria-label="事件記録を検索" value="${h(state.incidentSearch)}" /></label>
        <label class="incident-sort-label">並び順<select id="incident-sort"><option value="asc" ${state.incidentSort==='asc'?'selected':''}>古い年代から</option><option value="desc" ${state.incidentSort==='desc'?'selected':''}>新しい年代から</option></select></label></div></div>
      ${incidentTableAlert()}
      ${editing && !state.incidentError ? `<div class="editor-bar"><button type="button" id="add-incident" class="action-primary">＋ 新しい事件を追加</button><button type="button" id="backup-json" class="action-secondary">情報をJSONで保存</button></div>` : ''}
      <div id="incident-results" class="incident-list" aria-live="polite"></div>
    </section>`;
    $('#incident-search').addEventListener('input',e=>{state.incidentSearch=e.target.value;populateIncidents();});
    $('#incident-sort').addEventListener('change',e=>{state.incidentSort=e.target.value;populateIncidents();});
    if ($('#add-incident')) $('#add-incident').addEventListener('click',createIncident);
    if ($('#backup-json')) $('#backup-json').addEventListener('click',downloadBackup);
    populateIncidents();
  }
  function populateIncidents() {
    const q = state.incidentSearch.trim().toLocaleLowerCase('ja-JP');
    const items = sortedIncidents(state.incidents.filter(i =>
      `${i.name} ${i.occurredLabel} ${i.place}`.toLocaleLowerCase('ja-JP').includes(q)));
    $('#incident-results').innerHTML = items.length ? items.map(incidentCard).join('') :
      `<p class="empty-message">${state.incidentError ? '事件記録の準備が完了していません。' : q ? '一致する事件が見つかりませんでした。' : 'まだ登録された事件はありません。'}</p>`;
  }
  function linksOfIncident(i) { return state.incidentPeople.filter(p => p.incident_id === i.dbId); }
  function incidentPersonCard(link) {
    const c=state.chars.find(c=>c.dbId===link.character_id);
    if (!c) return '';
    return `<a class="incident-person-card" href="#/character/${encodeURIComponent(c.slug)}"><img src="${escapeSrc(cardVisual(c))}" alt="" loading="lazy"/><span class="incident-person-text"><strong>${h(c.name)}</strong><small>${h(link.role || '関係者')}</small></span><span class="incident-card-arrow" aria-hidden="true">↗</span></a>`;
  }
  function incidentPersonEditorRow(char,role='') {
    return `<div class="incident-person-edit-row" data-character-id="${h(char.dbId)}">
      <img src="${escapeSrc(cardVisual(char))}" alt="" loading="lazy"/>
      <span class="incident-person-edit-name">${h(char.name)}</span>
      <label>関わり方<input data-person-role type="text" maxlength="200" placeholder="例：目撃者・被害者・加害者" value="${h(role)}" /></label>
      <button type="button" class="action-danger incident-remove-person" aria-label="${h(char.name)}を関係者から外す">×</button>
    </div>`;
  }
  function incidentReadPanel(i,tab) {
    if (tab === 'overview') return `<div class="incident-prose">${h(i.overview || '概要はまだ記録されていません。')}</div>`;
    if (tab === 'damage') return `<div class="incident-prose">${h(i.damage || '被害状況はまだ記録されていません。')}</div>`;
    const rows = linksOfIncident(i).map(incidentPersonCard).filter(Boolean);
    return rows.length ? `<div class="incident-people-grid">${rows.join('')}</div>` : '<p class="incident-empty">関係者はまだ登録されていません。</p>';
  }
  function renderIncident(i) {
    state.current = null;
    document.title = `${i.name} | ${SITE_SETTINGS.siteName}`;
    const editing = state.admin && state.edit;
    const links = linksOfIncident(i);
    const people = links.map(link=>({char:state.chars.find(c=>c.dbId===link.character_id),role:link.role})).filter(x=>x.char);
    const top = editing ? `<form id="incident-edit-form" class="incident-edit-form">
      <div class="incident-edit-meta">
        <label>事件名<input name="name" type="text" required maxlength="160" value="${h(i.name)}" /></label>
        <label>年代（表示用）<input name="occurred_label" type="text" maxlength="120" placeholder="例：2150年 / 第三紀 / 時期不明" value="${h(i.occurredLabel)}" /></label>
        <label>時系列の並び順（年数）<input name="sort_year" type="number" step="1" min="-2147483648" max="2147483647" placeholder="例：2150。未設定なら末尾" value="${i.sortYear == null ? '' : h(i.sortYear)}" /><small>「2050年」「紀元前100年」などは自動判定します。独自の紀年法はここに年数を指定してください。未設定の事件は末尾になります。</small></label>
        <label>発生場所<input name="place" type="text" maxlength="240" value="${h(i.place)}" /></label>
      </div>
      <div class="incident-tabs" role="tablist" aria-label="事件の記録項目">
        ${incidentTabButtons()}
      </div>
      <div data-incident-panel="overview" class="incident-panel" ${state.incidentTab==='overview'?'':'hidden'}><label>事件の概要<textarea name="overview" rows="10" maxlength="50000" placeholder="発生した経緯や結末などを自由に記入してください。">${h(i.overview)}</textarea></label></div>
      <div data-incident-panel="damage" class="incident-panel" ${state.incidentTab==='damage'?'':'hidden'}><label>被害の記録<textarea name="damage" rows="10" maxlength="50000" placeholder="人的被害・施設の損壊・事件の影響などを記入してください。">${h(i.damage)}</textarea></label></div>
      <div data-incident-panel="people" class="incident-panel" ${state.incidentTab==='people'?'':'hidden'}>
        <p class="incident-help">既存のキャラクター一覧から登録できます。役割は空欄でも構いません。追加・解除した内容は下の「変更を保存」で確定します。</p>
        <div id="incident-person-editor-list" class="incident-person-editor-list">${people.map(x=>incidentPersonEditorRow(x.char,x.role)).join('')}</div>
        <div class="incident-person-add"><select id="incident-person-select" aria-label="関係者として登録するキャラクター"><option value="">キャラクターを選択</option>${state.chars.map(c=>`<option value="${h(c.dbId)}">${h(c.name)}（${h(affiliationOf(c))}）</option>`).join('')}</select><button type="button" id="incident-add-person" class="action-secondary">＋ 関係者に追加</button></div>
      </div>
      <label class="incident-publish-check"><input name="published" type="checkbox" ${i.published?'checked':''} /> この事件を一般公開する</label>
      <div class="editor-actions"><button class="action-primary" type="submit">変更を保存</button><button id="delete-incident" class="action-danger" type="button">事件を削除</button></div>
    </form>` : `<div class="incident-tabs" role="tablist" aria-label="事件の記録項目">${incidentTabButtons()}</div><section id="incident-read-panel" class="incident-panel" role="tabpanel">${incidentReadPanel(i,state.incidentTab)}</section>`;
    app.innerHTML = `<section class="detail-top"><a href="#/incidents" class="back-link"><span>←</span> BACK TO INCIDENTS</a><span class="detail-file">INCIDENT RECORD <span class="file-num">/ ${h(i.occurredLabel)}</span></span></section>
      <section class="incident-detail"><div class="eyebrow"><span class="eyebrow-line"></span> INCIDENT FILE</div>
        <h1>${h(i.name)}</h1><div class="incident-meta"><span>◷ ${h(i.occurredLabel)}</span><span>⌖ ${h(i.place || '場所未設定')}</span>${state.admin&&!i.published?'<span class="incident-draft">非公開</span>':''}</div>
        ${top}
      </section><div class="bottom-navigation"><a href="#/incidents">← RETURN TO ALL INCIDENTS</a><span>END OF INCIDENT FILE</span></div>`;
    $$('.incident-tab').forEach(btn=>btn.addEventListener('click',()=>switchIncidentTab(i,btn.dataset.tab)));
    if (editing) {
      $('#incident-edit-form').addEventListener('submit',e=>saveIncident(e,i));
      $('#delete-incident').addEventListener('click',()=>deleteIncident(i));
      $('#incident-add-person').addEventListener('click',addIncidentPerson);
      $('#incident-person-editor-list').addEventListener('click',event=>{
        const btn=event.target.closest('.incident-remove-person');
        if (btn) btn.closest('.incident-person-edit-row').remove();
      });
    }
  }
  function incidentTabButtons() {
    const names={overview:'概要',damage:'被害',people:'関係者'};
    return Object.entries(names).map(([key,label])=>`<button type="button" class="incident-tab ${state.incidentTab===key?'selected':''}" data-tab="${key}" role="tab" aria-selected="${state.incidentTab===key}">${label}</button>`).join('');
  }
  function switchIncidentTab(i,tab) {
    state.incidentTab = tab;
    $$('.incident-tab').forEach(btn=>{
      const on=btn.dataset.tab===tab;
      btn.classList.toggle('selected',on); btn.setAttribute('aria-selected',String(on));
    });
    if (state.admin && state.edit) {
      $$('[data-incident-panel]').forEach(el=>{el.hidden=el.dataset.incidentPanel!==tab;});
    } else $('#incident-read-panel').innerHTML=incidentReadPanel(i,tab);
  }
  function addIncidentPerson() {
    const id=$('#incident-person-select').value;
    const c=state.chars.find(c=>c.dbId===id);
    if (!c) return message('登録するキャラクターを選択してください。',true);
    if ($$('.incident-person-edit-row').some(r=>r.dataset.characterId===id)) return message('このキャラクターは登録済みです。',true);
    $('#incident-person-editor-list').insertAdjacentHTML('beforeend',incidentPersonEditorRow(c));
    $('#incident-person-select').value='';
  }
  async function createIncident() {
    if (state.incidentError || state.busy) return;
    const name=prompt('新しい事件の名前を入力してください。');
    if (name===null) return;
    if (!name.trim()) return message('事件名を入力してください。',true);
    const slug=`incident-${uuid()}`;
    await mutation(async()=>{
      const {data,error}=await state.db.from('incidents').insert({slug,name:name.trim().slice(0,160),is_published:false})
        .select('id').single();
      if (error||!data) throw error||Error('事件を登録できませんでした。');
    },'事件を非公開で作成しました。');
    if (state.incidents.some(i=>i.slug===slug)) {state.incidentTab='overview';location.hash=`#/incident/${encodeURIComponent(slug)}`;}
  }
  function inferredSortYear(label) {
    // 「2050年」「2050年代」「紀元前100年」など、明確な年表記だけ自動変換します。
    const text=label.trim();
    const bce=text.match(/^紀元前\s*([0-9]{1,4})年/);
    if (bce) return -Number(bce[1]);
    const ce=text.match(/^(?:西暦\s*)?([0-9]{1,4})(?:年|年代|$)/);
    return ce ? Number(ce[1]) : null;
  }
  function saveIncident(event,i) {
    event.preventDefault();
    const form=event.currentTarget;
    const f=new FormData(form);
    const name=String(f.get('name')||'').trim();
    if (!name) return message('事件名を入力してください。',true);
    const yearLabel=String(f.get('occurred_label')||'').trim()||'年代未設定';
    const rawYear=String(f.get('sort_year')||'').trim();
    const sortYear=rawYear===''?inferredSortYear(yearLabel):Number(rawYear);
    if (sortYear!==null && (!Number.isSafeInteger(sortYear)||sortYear< -2147483648||sortYear>2147483647))
      return message('並び順の年数は整数で入力してください。',true);
    const selection=$$('.incident-person-edit-row').map(row=>({
      incident_id:i.dbId,character_id:row.dataset.characterId,
      role:$('[data-person-role]',row).value.trim(),
    }));
    mutation(async()=>{
      const {data,error}=await state.db.from('incidents').update({
        name,occurred_label:yearLabel,
        sort_year:sortYear,place:String(f.get('place')||'').trim(),
        overview:String(f.get('overview')||''),damage:String(f.get('damage')||''),
        is_published:f.get('published')==='on',
      }).eq('id',i.dbId).select('id').single();
      if (error || !data) throw error||Error('更新対象が見つかりません。');
      if (selection.length) {
        const {error:linkError}=await state.db.from('incident_people').upsert(selection,{onConflict:'incident_id,character_id'});
        if (linkError) throw linkError;
      }
      for (const old of linksOfIncident(i)) {
        if (selection.some(p=>p.character_id===old.character_id)) continue;
        const {error:delError}=await state.db.from('incident_people').delete()
          .eq('incident_id',i.dbId).eq('character_id',old.character_id);
        if (delError) throw delError;
      }
    },'事件記録を保存しました。');
  }
  async function deleteIncident(i) {
    if (!confirm(`「${i.name}」を削除しますか？\n概要・被害・関係者の登録も消えます。元には戻せません。`)) return;
    await mutation(async()=>{
      const {error}=await state.db.from('incidents').delete().eq('id',i.dbId);
      if (error) throw error;
      location.hash='#/incidents';
    },'事件を削除しました。');
  }
  function relatedIncidentsForCharacter(c) {
    if (!c.dbId || state.incidentError) return '';
    const related=sortedIncidents(state.incidents.filter(i=>state.incidentPeople.some(p=>p.character_id===c.dbId&&p.incident_id===i.dbId)));
    if (!related.length) return '';
    return `<section class="related-incidents"><div class="profile-title">RELATED INCIDENTS <span>↗</span></div>
      <p class="related-incidents-heading">関連事件</p><div class="incident-list">${related.map(incidentCard).join('')}</div></section>`;
  }

  function oneProfileEditField(field = {label:'',value:''}) {
    return `<div class="edit-profile-row">
      <input aria-label="項目名" class="field-label" placeholder="項目名" maxlength="60" value="${h(field.label)}"/>
      <input aria-label="内容" class="field-value" placeholder="内容" maxlength="500" value="${h(field.value)}"/>
      <div class="profile-row-controls">
        <button class="move-field" data-field-move="up" type="button" aria-label="この項目を上へ移動">↑</button>
        <button class="move-field" data-field-move="down" type="button" aria-label="この項目を下へ移動">↓</button>
        <button class="remove-field" type="button" aria-label="この項目を削除">×</button>
      </div>
    </div>`;
  }
  function profileEditFields(c) { return (c.profile || []).map(oneProfileEditField).join(''); }
  function updateProfileMoveButtons() {
    const rows = $$('.edit-profile-row', $('#editor-fields'));
    rows.forEach((row, i) => {
      $('[data-field-move="up"]', row).disabled = i === 0;
      $('[data-field-move="down"]', row).disabled = i === rows.length - 1;
    });
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
        <label>キャラクター番号<input name="number" value="${h(c.number)}" maxlength="20" required placeholder="001" /><small class="edit-hint">例：001、025、EX01。番号を変えてもキャラの表示順は変わりません。</small></label>
        <label>所属<input name="affiliation" value="${h(affiliationOf(c))}" list="affiliation-suggestions" maxlength="120" placeholder="所属未設定" /><small class="edit-hint">同じ所属名のキャラは一覧で同じ見出しの下に並びます。</small></label>
        <datalist id="affiliation-suggestions">${[...new Set(state.chars.map(affiliationOf))].map(a=>`<option value="${h(a)}"></option>`).join('')}</datalist>
        <label>分類タグ<input name="category" value="${h(c.category)}" maxlength="120" /></label>
        <label>キャッチコピー<input name="catchphrase" value="${h(c.catchphrase)}" maxlength="300" /></label>
        <label>紹介文<textarea name="description" rows="7" maxlength="20000">${h(c.description)}</textarea></label>
        <section class="thumbnail-editor" aria-label="一覧用サムネイル設定">
          <div class="profile-title">LIST THUMBNAIL <span>↗</span></div>
          <p class="edit-hint">一覧専用の画像です。メイン画像やギャラリーには影響しません。設定しない場合はメイン画像を使用します。</p>
          <div class="thumbnail-editor-body"><img class="thumbnail-preview" src="${escapeSrc(cardVisual(c))}" alt="${h(c.name)}の一覧用サムネイル"/>
            <div class="thumbnail-editor-actions"><button id="thumbnail-replace" class="action-primary" type="button">一覧用画像を変更</button>
              <button id="thumbnail-reset" class="action-secondary" type="button" ${c.thumbnailPath?'':'disabled'}>メイン画像を使う</button>
              <small class="edit-hint">画像変更はアップロード後すぐ保存されます。文章は下の「変更を保存」で保存してください。</small></div></div>
        </section>
        <div class="profile-title">BASIC INFORMATION <span>↘</span></div><div id="editor-fields">${profileEditFields(c)}</div>
        <button type="button" id="add-field" class="action-secondary">＋ プロフィール項目を追加</button>
        <label class="publish-check"><input type="checkbox" name="published" ${c.published?'checked':''}/> このキャラを一般公開する</label>
        <div class="editor-actions"><button class="action-primary" type="submit">変更を保存</button><button id="delete-character" class="action-danger" type="button">キャラを削除</button></div>
      </form>` : `
        <div class="detail-name-wrap"><p class="detail-kicker">CHARACTER PROFILE</p><h1>${h(c.name)}</h1>${c.reading?`<p class="reading">${h(c.reading)}</p>`:''}</div>
        <div class="description-block"><p class="catchphrase">${h(c.catchphrase)}</p><p class="description">${h(c.description)}</p></div>
        <div class="profile-table"><div class="profile-title">BASIC INFORMATION <span>↘</span></div><dl>${fields}</dl></div>`;
    const editMain = editing ? `<div class="image-edit-row"><button id="main-replace" class="action-primary" type="button">メイン画像を変更</button><button id="main-zoom" class="action-secondary" type="button">拡大</button></div>` : '';
    app.innerHTML = `
      <section class="detail-top"><a class="back-link" href="#/"><span>←</span> BACK TO CHARACTERS</a><span class="detail-file">CHARACTER FILE <span class="file-num">/ ${h(c.number)}</span></span></section>
      <section class="detail-main"><div class="detail-art"><div class="main-art-frame"><button id="main-image-button" type="button" class="main-image-button" aria-label="${editing?'画像を変更':'現在の画像を拡大表示'}"><img id="detail-main-img" src="${escapeSrc(mainVisual(c))}" alt="${h(c.name)}の画像" /><span class="zoom-hint">${editing?'↗ TAP TO REPLACE':'↗ CLICK TO ENLARGE'}</span></button></div>${editMain}<span class="art-corner-label">© ORIGINAL CHARACTER ARCHIVE</span></div>
        <div class="detail-info"><div class="detail-info-top"><span class="character-tag"><span class="tag-dot"></span> ${h(c.category)}</span><span class="detail-number">NO. ${h(c.number)} ${state.admin&&!c.published?' / 非公開':''}</span></div>${textSection}</div></section>
      ${relatedIncidentsForCharacter(c)}
      <section class="gallery-section" aria-label="画像ギャラリー"><div class="gallery-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> ADDITIONAL VISUALS</div><h2>GALLERY<span class="title-period">.</span></h2></div><p>${editing?'画像の差し替え・削除や並び替えができます。':'画像を選択して切り替えられます。'}<br/>拡大表示では左右の画像へ移動できます。</p></div>
        <div class="gallery-toolbar"><div><span id="gallery-current">${c.imageItems.length?'01':'00'}</span> <span class="gallery-slash">/</span> ${String(c.imageItems.length).padStart(2,'0')}</div><div class="gallery-buttons"><button id="gallery-prev" type="button" aria-label="前の画像">←</button><button id="gallery-next" type="button" aria-label="次の画像">→</button></div></div>
        ${editing?'<div class="editor-bar"><button id="gallery-add" class="action-primary" type="button">＋ 画像を追加</button></div>':''}<div id="gallery-thumbs" class="gallery-thumbs"></div></section>
      <div class="bottom-navigation"><a href="#/">← RETURN TO ALL CHARACTERS</a><span>END OF FILE ${h(c.number)}</span></div>`;
    const mainAction = () => {
      if (!editing) return openLightbox();
      chooseFile({kind:'main',character:c});
    };
    $('#main-image-button').addEventListener('click', mainAction);
    if ($('#main-replace')) $('#main-replace').addEventListener('click', mainAction);
    if ($('#main-zoom')) $('#main-zoom').addEventListener('click', openLightbox);
    if ($('#thumbnail-replace')) $('#thumbnail-replace').addEventListener('click', () => chooseFile({kind:'thumbnail',character:c}));
    if ($('#thumbnail-reset')) $('#thumbnail-reset').addEventListener('click', () => resetThumbnail(c));
    $('#gallery-prev').addEventListener('click', () => showImage(state.imageIndex-1));
    $('#gallery-next').addEventListener('click', () => showImage(state.imageIndex+1));
    if ($('#gallery-add')) $('#gallery-add').addEventListener('click', () => chooseFile({kind:'add', character:c}));
    if (editing) {
      $('#character-edit-form').addEventListener('submit', saveCharacter);
      $('#delete-character').addEventListener('click', () => deleteCharacter(c));
      $('#add-field').addEventListener('click', () => {
        $('#editor-fields').insertAdjacentHTML('beforeend', oneProfileEditField());
        updateProfileMoveButtons();
      });
      $('#editor-fields').addEventListener('click', event => {
        const row = event.target.closest('.edit-profile-row');
        if (!row) return;
        if (event.target.closest('.remove-field')) row.remove();
        const button = event.target.closest('[data-field-move]');
        if (button && !button.disabled) {
          if (button.dataset.fieldMove === 'up' && row.previousElementSibling) row.previousElementSibling.before(row);
          if (button.dataset.fieldMove === 'down' && row.nextElementSibling) row.nextElementSibling.after(row);
          // フォーム入力を再生成せず、DOMだけ動かすので入力途中の文字が消えません。
          button.focus();
        }
        updateProfileMoveButtons();
      });
      updateProfileMoveButtons();
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
    const number = String(data.get('number')||'').trim();
    if (!number) return message('キャラクター番号を入力してください。', true);
    if (state.chars.some(other => other.dbId !== c.dbId && other.number === number)) {
      return message(`番号「${number}」は別のキャラに使用されています。別の番号を入力してください。`, true);
    }
    const affiliation = String(data.get('affiliation')||'').trim() || '所属未設定';
    const fields = $$('.edit-profile-row',f).map(row => ({
      label:$('.field-label',row).value.trim(), value:$('.field-value',row).value.trim()
    })).filter(row => row.label || row.value);
    mutation(async () => {
      const values = {
        name, name_reading:String(data.get('reading')||''), description:String(data.get('description')||''),
        is_published:data.get('published')==='on',
        profile:{ ...c.rawProfile, number, affiliation, category:String(data.get('category')||'ORIGINAL CHARACTER'), catchphrase:String(data.get('catchphrase')||''), fields },
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
        sort_order:Math.max(-1,...state.chars.map(c => c.sortOrder ?? -1)) + 1,
        profile:{number:String(Math.max(0,...state.chars.map(c => parseInt(c.number,10)||0))+1).padStart(3,'0'),affiliation:'所属未設定',category:'ORIGINAL CHARACTER',catchphrase:'',fields:[]},
      }).select('id').single();
      if (error || !data) throw error || Error('作成できませんでした。');
    },'非公開キャラクターを新規登録しました。');
    if (state.chars.some(c => c.slug === slug)) location.hash = `#/character/${slug}`;
  }
  async function deleteCharacter(c) {
    if (!confirm(`「${c.name}」を削除しますか？\nプロフィールと画像の参照が削除されます。この操作は元に戻せません。`)) return;
    await mutation(async () => {
      const paths = [...new Set([c.mainPath,c.thumbnailPath,...c.extraImages.map(i=>i.storage_path)].filter(p => p && !isLocal(p)))];
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
        if (target.kind==='thumbnail') {
          const {data:row,error:readError} = await state.db.from('characters').select('profile').eq('id',target.character.dbId).single();
          if (readError) throw readError;
          const {error} = await state.db.from('characters').update({profile:{...(row.profile || {}),thumbnailPath:path}}).eq('id',target.character.dbId);
          if (error) throw error;
        } else if (target.kind==='main' || target.image?.kind==='main') {
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
      const oldPath = target.kind==='thumbnail' ? target.character.thumbnailPath
        : target.kind==='main' ? target.character.mainPath : target.image?.path;
      // 別の表示場所で参照されている画像ファイルは削除しません。
      // 画像パスを直接共有している場合は、削除ではなく残す方を優先します。
      const sharedElsewhere = target.kind==='thumbnail'
        ? oldPath === target.character.mainPath || target.character.extraImages.some(i=>i.storage_path===oldPath)
        : target.kind==='main'
          ? oldPath === target.character.thumbnailPath || target.character.extraImages.some(i=>i.storage_path===oldPath)
          : oldPath === target.character.mainPath || oldPath === target.character.thumbnailPath || target.character.extraImages.some(i=>i.storage_path===oldPath && i.dbImageId!==target.image?.dbImageId);
      if (oldPath && !isLocal(oldPath) && oldPath!==path && !sharedElsewhere) {
        const clean = await fromStore().remove([oldPath]);
        if (clean.error) console.warn('Could not clean old image:',clean.error.message);
      }
    },'画像をアップロードしました。');
  });
  function resetThumbnail(c) {
    if (!c.thumbnailPath) return;
    mutation(async () => {
      const {data:row,error:readError} = await state.db.from('characters').select('profile').eq('id',c.dbId).single();
      if (readError) throw readError;
      const profile = {...(row.profile || {})};
      // 別の端末ですでに別画像に変更されている場合も、現在の保存値だけ解除します。
      const oldPath = profile.thumbnailPath;
      profile.thumbnailPath = null;
      const {error} = await state.db.from('characters').update({profile}).eq('id',c.dbId);
      if (error) throw error;
      if (oldPath && !isLocal(oldPath) && oldPath!==c.mainPath && !c.extraImages.some(i=>i.storage_path===oldPath)) {
        const clean = await fromStore().remove([oldPath]);
        if (clean.error) console.warn('Thumbnail cleanup:',clean.error.message);
      }
    },'一覧の画像をメイン画像に戻しました。');
  }
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
          profile:{ number:c.number, affiliation:c.affiliation || fallbackAffiliation(c.category), category:c.category, catchphrase:c.catchphrase, fields:c.profile, thumbnailPath:c.thumbnailSrc || null },
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
    const data = state.chars.map(c => ({
      name:c.name,slug:c.slug,number:c.number,sortOrder:c.sortOrder,description:c.description,
      reading:c.reading,category:c.category,affiliation:affiliationOf(c),catchphrase:c.catchphrase,
      profile:c.profile,published:c.published,mainPath:c.mainPath,thumbnailPath:c.thumbnailPath,
      gallery:c.extraImages?.map(i=>({path:i.storage_path,caption:i.caption,sortOrder:i.sort_order}))||[],
    }));
    const incidents=state.incidents.map(i=>({
      slug:i.slug,name:i.name,occurredLabel:i.occurredLabel,sortYear:i.sortYear,
      place:i.place,overview:i.overview,damage:i.damage,published:i.published,
      people:linksOfIncident(i).map(p=>({
        characterSlug:state.chars.find(c=>c.dbId===p.character_id)?.slug||null,
        role:p.role,
      })),
    }));
    const blob = new Blob([JSON.stringify({exportedAt:new Date().toISOString(),characters:data,incidents},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download=`hizumi-kyosei-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('キャラクター・事件・関係者のJSONを保存しました。画像そのものは含まれません。');
  }
  window.addEventListener('hashchange', () => { state.imageIndex=0; state.incidentTab='overview'; draw(); window.scrollTo(0,0); });
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
