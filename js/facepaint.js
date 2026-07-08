/* facepaint.js — プレイヤーが人型の顔を自由に描くキャンバス (要件⑩) */
const FacePaint = (() => {
  const SKIN = '#e8b98a';
  const COLORS = ['#1b1b1b', '#ffffff', '#d8322c', '#2c53d8', '#f2c12e', '#6b3f22', SKIN];

  let canvas, ctx, color = '#1b1b1b', size = 10, erasing = false, drawing = false, last = null;

  function drawDefaultFace(c) {
    const x = c.getContext('2d');
    x.fillStyle = SKIN;
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#1b1b1b';
    // 眉
    x.fillRect(58, 78, 52, 10);
    x.fillRect(146, 78, 52, 10);
    // 目
    x.beginPath(); x.arc(84, 112, 13, 0, 7); x.fill();
    x.beginPath(); x.arc(172, 112, 13, 0, 7); x.fill();
    // 鼻
    x.strokeStyle = '#b5794a'; x.lineWidth = 7; x.lineCap = 'round';
    x.beginPath(); x.moveTo(128, 120); x.lineTo(128, 158); x.stroke();
    // 口(にやり)
    x.strokeStyle = '#7c2b1e'; x.lineWidth = 9;
    x.beginPath(); x.arc(128, 176, 40, 0.25 * Math.PI, 0.75 * Math.PI); x.stroke();
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * canvas.width,
      y: (e.clientY - r.top) / r.height * canvas.height,
    };
  }

  function stroke(a, b) {
    ctx.strokeStyle = erasing ? SKIN : color;
    ctx.lineWidth = erasing ? size * 2.2 : size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function init() {
    canvas = document.getElementById('face-canvas');
    ctx = canvas.getContext('2d');

    const saved = localStorage.getItem('ff3d_face');
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, 256, 256);
      img.src = saved;
    } else {
      drawDefaultFace(canvas);
    }

    // 色見本
    const box = document.getElementById('face-colors');
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' sel' : '');
      b.style.background = c;
      b.addEventListener('click', () => {
        color = c; erasing = false;
        box.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
        b.classList.add('sel');
        document.getElementById('face-eraser').classList.remove('sel');
      });
      box.appendChild(b);
    });

    document.querySelectorAll('.brush-size').forEach(b => {
      b.addEventListener('click', () => {
        size = +b.dataset.size;
        document.querySelectorAll('.brush-size').forEach(s => s.classList.remove('sel'));
        b.classList.add('sel');
      });
    });
    document.getElementById('face-eraser').addEventListener('click', e => {
      erasing = !erasing;
      e.target.classList.toggle('sel', erasing);
    });
    document.getElementById('face-clear').addEventListener('click', () => {
      ctx.fillStyle = SKIN; ctx.fillRect(0, 0, 256, 256);
    });
    document.getElementById('face-default').addEventListener('click', () => drawDefaultFace(canvas));

    canvas.addEventListener('pointerdown', e => {
      drawing = true; last = pos(e);
      stroke(last, last);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = pos(e);
      stroke(last, p);
      last = p;
      e.preventDefault();
    });
    const up = () => { drawing = false; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  function save() {
    const url = canvas.toDataURL('image/png');
    localStorage.setItem('ff3d_face', url);
    return url;
  }

  function current() {
    return localStorage.getItem('ff3d_face') || defaultDataURL();
  }

  function defaultDataURL() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    drawDefaultFace(c);
    return c.toDataURL('image/png');
  }

  return { init, save, current, defaultDataURL };
})();
