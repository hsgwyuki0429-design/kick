/* main.js — 画面遷移 / 名前登録(要件⑨) / メニュー / オンラインロビー(要件⑧) */
(() => {
  let name = localStorage.getItem('ff3d_name') || '';
  let net = null;
  let match = null;
  let inRoom = false;

  const $ = id => document.getElementById(id);

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $('screen-game').classList.add('hidden');
    $(id).classList.remove('hidden');
  }

  /* ---------- 名前 (要件⑨: 対戦時に表示、重複はサーバーが禁止) ---------- */
  function initName() {
    $('name-input').value = name;
    $('name-ok').addEventListener('click', () => {
      const v = $('name-input').value.trim();
      if (v.length < 1 || v.length > 12) {
        $('name-error').textContent = '1〜12文字で入力してください';
        return;
      }
      name = v;
      localStorage.setItem('ff3d_name', name);
      $('name-error').textContent = '';
      if (!localStorage.getItem('ff3d_face')) show('screen-face');
      else showMenu();
    });
  }

  /* ---------- 顔ペイント (要件⑩) ---------- */
  function initFace() {
    FacePaint.init();
    $('face-ok').addEventListener('click', () => {
      FacePaint.save();
      showMenu();
    });
  }

  /* ---------- メニュー ---------- */
  function showMenu() {
    $('menu-hello').textContent = 'ようこそ、' + name + ' 選手!';
    show('screen-menu');
  }

  function initMenu() {
    $('menu-cpu').addEventListener('click', startCpuMatch);
    $('menu-online').addEventListener('click', openOnline);
    $('menu-face').addEventListener('click', () => show('screen-face'));
    $('menu-rename').addEventListener('click', () => show('screen-name'));
  }

  /* ---------- CPU戦 (要件②) ---------- */
  function startCpuMatch() {
    show('screen-game');
    match = new Game.Match({
      mode: 'cpu',
      myName: name,
      oppName: 'CPU アイアン堀田',
      myFace: FacePaint.current(),
      oppFace: FacePaint.defaultDataURL(),
      onEnd: () => { match = null; showMenu(); },
    });
  }

  /* ---------- オンライン (要件⑧) ---------- */
  function autoServerUrl() {
    if (location.protocol === 'https:') return 'wss://' + location.host;
    if (location.protocol === 'http:') return 'ws://' + location.host;
    return null;
  }

  function openOnline() {
    const auto = autoServerUrl();
    if (auto) {
      $('server-auto-url').textContent = auto;
      $('server-auto').classList.remove('hidden');
      $('server-manual').classList.add('hidden');
    } else {
      $('server-auto').classList.add('hidden');
      $('server-manual').classList.remove('hidden');
      $('server-input').value = localStorage.getItem('ff3d_server') || 'ws://localhost:8787';
    }
    $('online-status').textContent = '';
    $('room-panel').classList.add('hidden');
    show('screen-online');
  }

  function status(msg) { $('online-status').textContent = msg; }

  function bindLobbyHandlers() {
    net.on('room', m => {
      inRoom = true;
      $('room-panel').classList.remove('hidden');
      $('room-name').textContent = m.room;
      const ul = $('member-list');
      ul.innerHTML = '';
      m.members.forEach(mem => {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = mem.name + (mem.name === name ? ' (あなた)' : '');
        li.appendChild(label);
        if (mem.busy) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = '対戦中';
          li.appendChild(tag);
        } else if (mem.name !== name) {
          const b = document.createElement('button');
          b.className = 'btn primary';
          b.textContent = '対戦申請';
          b.addEventListener('click', () => {
            net.challenge(mem.name);
            status(mem.name + ' に対戦を申し込みました…');
          });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
    });

    net.on('challenged', m => { 
      $('challenge-text').textContent = m.from + ' から対戦申請が来ました!';
      $('challenge-modal').classList.remove('hidden');
      $('challenge-accept').onclick = () => {
        $('challenge-modal').classList.add('hidden');
        net.accept(m.from);
      };
      $('challenge-decline').onclick = () => {
        $('challenge-modal').classList.add('hidden');
        net.decline(m.from);
      };
    });

    net.on('declined', m => status(m.by + ' に断られました…'));

    net.on('matchStart', m => { 
      if (match) return;
      $('challenge-modal').classList.add('hidden');
      startOnlineMatch(m.opponent);
    });

    net.on('disconnected', () => {
      inRoom = false;
      if (!match) {
        $('room-panel').classList.add('hidden');
        status('サーバーから切断されました');
      }
    });
  }

  function startOnlineMatch(opponent) {
    show('screen-game');
    match = new Game.Match({
      mode: 'online',
      net,
      myName: name,
      oppName: opponent,
      myFace: FacePaint.current(),
      oppFace: null, 
      onEnd: () => {
        match = null;
        net.endMatch();
        bindLobbyHandlers(); 
        openOnline();
        if (net.connected && inRoom) $('room-panel').classList.remove('hidden');
      },
    });
    net.game({ k: 'face', data: FacePaint.current() });
  }

  function initOnline() {
    $('online-join').addEventListener('click', async () => {
      const auto = autoServerUrl();
      const url = auto || $('server-input').value.trim();
      const pass = $('room-input').value.trim();
      if (!url) { status('サーバーURLを入力してください'); return; }
      if (!pass) { status('部屋の合言葉を入力してください'); return; }
      if (!auto) localStorage.setItem('ff3d_server', url);

      if (!net || !net.connected) {
        status('接続中…');
        net = new Net();
        try {
          await net.connect(url, name);
        } catch (e) {
          if (e.message === 'nameTaken') {
            // エラーメッセージを修正：合言葉のエラーだと勘違いさせないようにする
            status(`リングネーム「${name}」は現在他の人が使用中です。一度メニューに戻り「名前を変える」から変更してください。`);
          } else if (e.message === 'badName') {
            status('リングネームが不正です。メニューに戻って名前を変更してください。');
          } else {
            status('接続失敗: ' + e.message);
          }
          net = null;
          return;
        }
        bindLobbyHandlers();
      }
      status('入室しました');
      net.join(pass);
    });

    $('online-leave').addEventListener('click', () => {
      if (net) net.leaveRoom();
      inRoom = false;
      $('room-panel').classList.add('hidden');
      status('退室しました');
    });

    $('online-back').addEventListener('click', () => {
      if (net) { net.close(); net = null; }
      inRoom = false;
      showMenu();
    });
  }

  /* ---------- 起動 ---------- */
  addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
  initName();
  initFace();
  initMenu();
  initOnline();
  if (name) showMenu();
  else show('screen-name');
})();