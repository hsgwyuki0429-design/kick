import * as THREE from "three";
import { Puncher, punchOffset } from "./boxer.js";

const OPP_Z = -3.1;

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.shake = 0;
    this._buildRenderer();
    this._buildSceneGraph();
    window.addEventListener("resize", () => this._onResize());
  }

  _buildRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14141c);
    this.scene.fog = new THREE.Fog(0x14141c, 6, 16);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 100);
    this.camera.position.set(0, 1.62, 1.1);
    this.cameraRig = new THREE.Group();
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _buildSceneGraph() {
    // Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a1a10, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff3d6, 1.6);
    key.position.set(2.5, 5, 2);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x5588ff, 0.6, 12);
    rim.position.set(0, 3, -4);
    this.scene.add(rim);

    this._buildArena();
    this._buildOpponent();
    this._buildPlayerGloves();
  }

  _buildArena() {
    // Ring floor (canvas mat texture)
    const matCanvas = document.createElement("canvas");
    matCanvas.width = matCanvas.height = 256;
    const ctx = matCanvas.getContext("2d");
    ctx.fillStyle = "#7a1f2b";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 4;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
    const matTex = new THREE.CanvasTexture(matCanvas);
    matTex.wrapS = matTex.wrapT = THREE.RepeatWrapping;
    matTex.repeat.set(4, 4);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 0.15, 6.5),
      new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 })
    );
    floor.position.set(0, -0.075, -2.5);
    this.scene.add(floor);

    // Ropes + posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, roughness: 0.4 });
    const corners = [
      [-3.1, -5.5], [3.1, -5.5], [-3.1, 0.4], [3.1, 0.4],
    ];
    for (const [x, z] of corners) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8), postMat);
      post.position.set(x, 0.7, z);
      this.scene.add(post);
    }
    for (let h = 0; h < 3; h++) {
      const y = 0.35 + h * 0.35;
      const ropeGeoms = [
        { from: [-3.1, -5.5], to: [3.1, -5.5] },
        { from: [-3.1, -5.5], to: [-3.1, 0.4] },
        { from: [3.1, -5.5], to: [3.1, 0.4] },
      ];
      for (const seg of ropeGeoms) {
        const dx = seg.to[0] - seg.from[0];
        const dz = seg.to[1] - seg.from[1];
        const len = Math.hypot(dx, dz);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), ropeMat);
        rope.position.set((seg.from[0] + seg.to[0]) / 2, y, (seg.from[1] + seg.to[1]) / 2);
        // Align the cylinder's default +Y axis to the segment's direction in the XZ plane.
        const dir = new THREE.Vector3(dx, 0, dz).normalize();
        rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.scene.add(rope);
      }
    }

    // Simple arena walls / crowd-ish backdrop
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x20202c, roughness: 1 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), wallMat);
    backWall.position.set(0, 4, -8);
    this.scene.add(backWall);
  }

  _buildOpponent() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98a63, roughness: 0.7 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x1c3d8f, roughness: 0.8 });
    const glove = new THREE.MeshStandardMaterial({ color: 0xd11f1f, roughness: 0.5 });

    const root = new THREE.Group();
    root.position.set(0, 0, OPP_Z);
    this.scene.add(root);
    this.opponentRoot = root;

    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.35, 4, 8), shorts);
    hips.position.y = 0.65;
    root.add(hips);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 8), skin);
    torso.position.y = 1.25;
    root.add(torso);
    this.opponentTorso = torso;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 16), skin);
    head.position.y = 1.82;
    root.add(head);
    this.opponentHead = head;

    this.opponentArms = {};
    for (const side of ["L", "R"]) {
      const sx = side === "L" ? -0.42 : 0.42;
      const pivot = new THREE.Group();
      pivot.position.set(sx, 1.55, 0.05);
      root.add(pivot);

      const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 4, 8), skin);
      forearm.rotation.x = Math.PI / 2;
      forearm.position.set(0, -0.18, 0.2);
      pivot.add(forearm);

      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), glove);
      fist.position.set(0, -0.2, 0.42);
      pivot.add(fist);

      const idlePos = new THREE.Vector3(sx, 1.55, 0.05);
      const idleRot = new THREE.Euler(0.15, sx > 0 ? -0.15 : 0.15, 0);
      const puncher = new Puncher(pivot, idlePos, idleRot);
      this.opponentArms[side] = { pivot, puncher };
    }

    this.opponentTorsoPuncher = new Puncher(torso, torso.position.clone(), new THREE.Euler());
    this.opponentHeadPuncher = new Puncher(head, head.position.clone(), new THREE.Euler());
  }

  _buildPlayerGloves() {
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1f6fd1, roughness: 0.5 });
    this.playerGloves = {};
    for (const side of ["L", "R"]) {
      const sx = side === "L" ? -0.32 : 0.32;
      const group = new THREE.Group();
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), gloveMat);
      glove.scale.set(1, 0.85, 1.15);
      group.add(glove);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.18, 10), gloveMat);
      cuff.position.set(0, -0.14, 0.05);
      group.add(cuff);

      this.camera.add(group);
      const idlePos = new THREE.Vector3(sx, -0.42, -0.68);
      const idleRot = new THREE.Euler(0.35, sx > 0 ? -0.2 : 0.2, sx > 0 ? -0.15 : 0.15);
      const puncher = new Puncher(group, idlePos, idleRot);
      this.playerGloves[side] = { group, puncher };
    }
  }

  // ---- Public animation triggers ----------------------------------------

  playerPunch(hand, type) {
    const off = punchOffset("player", type);
    this.playerGloves[hand].puncher.trigger(off.pos.clone(), off.rot.clone(), off.out, off.back);
  }

  playerBlock(active) {
    for (const side of ["L", "R"]) {
      const sx = side === "L" ? -1 : 1;
      const pos = new THREE.Vector3(sx * -0.13, 0.28, 0.28);
      const rot = new THREE.Euler(0.4, 0, 0);
      this.playerGloves[side].puncher.setHold(pos, rot, active);
    }
  }

  opponentPunch(hand, type) {
    const off = punchOffset("opponent", type);
    this.opponentArms[hand].puncher.trigger(off.pos.clone(), off.rot.clone(), off.out, off.back);
  }

  opponentBlock(active) {
    for (const side of ["L", "R"]) {
      const sx = side === "L" ? -1 : 1;
      const pos = new THREE.Vector3(sx * -0.1, 0.3, -0.2);
      const rot = new THREE.Euler(-0.3, 0, 0);
      this.opponentArms[side].puncher.setHold(pos, rot, active);
    }
  }

  opponentHitReaction(strength = 1) {
    this.opponentHeadPuncher.trigger(
      new THREE.Vector3(0, 0.04 * strength, -0.12 * strength),
      new THREE.Euler(0.25 * strength, (Math.random() - 0.5) * 0.3, 0),
      50, 220
    );
    this.opponentTorsoPuncher.trigger(
      new THREE.Vector3(0, 0, -0.05 * strength), new THREE.Euler(0.1 * strength, 0, 0), 60, 260
    );
  }

  playerHitReaction(strength = 1) {
    this.shake = Math.min(1, this.shake + 0.5 * strength);
    document.getElementById("hitFlash")?.classList.add("show");
    setTimeout(() => document.getElementById("hitFlash")?.classList.remove("show"), 90);
  }

  opponentKO() {
    this._koAnim = { start: performance.now() };
  }

  resetPoses() {
    this.opponentRoot.rotation.set(0, 0, 0);
    this.opponentRoot.position.set(0, 0, OPP_Z);
    this._koAnim = null;
  }

  update() {
    const dt = this.clock.getDelta();
    const now = performance.now();
    const t = now / 1000;

    // idle sway / breathing
    const idleSway = new THREE.Vector3(Math.sin(t * 1.4) * 0.01, Math.sin(t * 2.1) * 0.008, 0);
    for (const side of ["L", "R"]) {
      this.opponentArms[side].puncher.update(now, idleSway);
      this.playerGloves[side].puncher.update(now);
    }
    this.opponentTorsoPuncher.update(now, new THREE.Vector3(0, Math.sin(t * 1.4) * 0.012, 0));
    this.opponentHeadPuncher.update(now, new THREE.Vector3(0, Math.sin(t * 1.4) * 0.01, 0));

    // camera idle bob + hit shake
    const bobY = Math.sin(t * 1.8) * 0.01;
    const bobX = Math.sin(t * 0.9) * 0.006;
    this.shake *= 0.88;
    const shakeOff = this.shake > 0.001
      ? new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.05, (Math.random() - 0.5) * this.shake * 0.05, 0)
      : new THREE.Vector3();
    this.camera.position.set(bobX + shakeOff.x, 1.62 + bobY + shakeOff.y, 1.1);

    if (this._koAnim) {
      const f = Math.min(1, (now - this._koAnim.start) / 900);
      this.opponentRoot.rotation.x = f * 1.3;
      this.opponentRoot.position.y = -f * 0.7;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
