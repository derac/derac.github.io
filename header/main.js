import { config, mouse, pointers } from './config.js';
import { Rope, Web, Torch, Fly, RockText } from './entities.js';
import { Spider } from './spider.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let width, height;
const ropes = [];
let web;
let spider;
let torch;
let fly;
let rockText;
const cocoons = [];

function init() {
    const rect = canvas.getBoundingClientRect();
    width = canvas.width = rect.width;
    height = canvas.height = rect.height;

    ropes.length = 0;
    cocoons.length = 0;

    // Mobile scaling factor
    const scale = Math.min(1, width / 800);

    web = new Web(width, 0, config.webRadius * scale, config.webComplexity);
    spider = new Spider(width, scale);
    torch = new Torch(config.torchSize * scale, config.torchSize * scale, scale);
    rockText = new RockText(width, height);

    if (!fly) {
        fly = new Fly(width, height, web);
    } else {
        fly.width = width;
        fly.height = height;
        fly.web = web;
        fly.reset();
    }

    for (let i = 0; i < config.ropeCount; i++) {
        const x1 = Math.random() * width;
        const x2 = Math.random() * width;
        const p1 = { x: x1, y: 0 };
        const p2 = { x: x2, y: 0 };



        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        let totalLength = dist * (1.1 + Math.random() * 0.2) + Math.random() * 250;

        // Limit maximum length to half screen width
        const maxLen = width / 2;
        if (totalLength > maxLen) {
            const scale = maxLen / totalLength;
            totalLength = maxLen;
            // Move p2 closer to p1 to respect the new length
            p2.x = p1.x + (p2.x - p1.x) * scale;
            p2.y = p1.y + (p2.y - p1.y) * scale;
        }

        ropes.push(new Rope(p1, p2, config.ropeSegments, totalLength));
    }
}

function resize() {
    init();
}

// Input Handling
function updatePointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let p = pointers.get(e.pointerId);
    if (!p) {
        p = { x, y, vx: 0, vy: 0, down: false, id: e.pointerId };
        pointers.set(e.pointerId, p);
    }

    p.vx = x - p.x;
    p.vy = y - p.y;
    p.x = x;
    p.y = y;
    p.down = (e.buttons > 0);
    p.isPrimary = e.isPrimary;

    // Sync primary pointer to legacy 'mouse' object for backward comp
    if (e.isPrimary) {
        mouse.x = p.x;
        mouse.y = p.y;
        mouse.vx = p.vx;
        mouse.vy = p.vy;
        mouse.down = p.down;
    }
}

function removePointer(e) {
    pointers.delete(e.pointerId);
    if (e.isPrimary) {
        mouse.down = false;
    }
}

window.addEventListener('resize', resize);
// Prevent default touch actions to allow dragging without scrolling (if needed, or careful CSS)
canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    updatePointer(e);
});
canvas.addEventListener('pointermove', updatePointer);
canvas.addEventListener('pointerup', removePointer);
canvas.addEventListener('pointercancel', removePointer);
// Keep mouse move for hover effects when no buttons pressed? 
// Pointermove handles hover too if device supports it.

function animate() {
    ctx.clearRect(0, 0, width, height);

    // 1. Logic Updates
    torch.update();

    // Draw Torch FIRST (Behind everything)
    torch.draw(ctx);

    // 2. Background Layer (Text) - Drawn FIRST so it is BEHIND everything
    rockText.draw(ctx, torch);

    // 3. Midground (Webs & Ropes)
    web.update();
    ropes.forEach(rope => {
        rope.update(height);
        rope.draw(ctx, torch);
    });
    web.draw(ctx, torch);

    // 4. Foreground Entities (Fly, Spider)
    fly.update();
    fly.draw(ctx, torch);

    spider.update(width, height, ropes, web, fly, cocoons);
    spider.draw(ctx, torch);

    // 5. Cocoons (also foreground)
    cocoons.forEach(c => {
        // Calculate position relative to attached point
        const spacing = 15;
        let dx = c.point.x - web.center.x;
        let dy = c.point.y - web.center.y;

        // Handle center point case or very close
        const dist = Math.hypot(dx, dy);
        if (dist < 0.1) { dx = Math.cos(c.rotation); dy = Math.sin(c.rotation); }
        else { dx /= dist; dy /= dist; }

        // Stack outward
        const x = c.point.x + dx * (c.index * spacing);
        const y = c.point.y + dy * (c.index * spacing);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(c.rotation);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    requestAnimationFrame(animate);
}

init();
animate();
