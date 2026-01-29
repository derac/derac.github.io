import { config, mouse } from './config.js';
import { Rope, Web, Torch, Fly } from './entities.js';
import { Spider } from './spider.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let width, height;
const ropes = [];
let web;
let spider;
let torch;
let fly;
const cocoons = [];

function init() {
    const rect = canvas.getBoundingClientRect();
    width = canvas.width = rect.width;
    height = canvas.height = rect.height;

    ropes.length = 0;
    cocoons.length = 0;

    web = new Web(width, 0, config.webRadius, config.webComplexity);
    spider = new Spider(width);
    torch = new Torch(40, 40);

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

        if (Math.random() > 0.6) {
            p2.x = Math.random() > 0.5 ? 0 : width;
            p2.y = Math.random() * 100;
        }

        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const totalLength = dist * (1.1 + Math.random() * 0.2);

        ropes.push(new Rope(p1, p2, config.ropeSegments, totalLength));
    }
}

function resize() {
    init();
}

window.addEventListener('resize', resize);
window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});
window.addEventListener('mousedown', () => mouse.down = true);
window.addEventListener('mouseup', () => mouse.down = false);

function animate() {
    ctx.clearRect(0, 0, width, height);

    torch.update();
    torch.draw(ctx);

    web.update();
    ropes.forEach(rope => {
        rope.update();
        rope.draw(ctx, torch);
    });
    web.draw(ctx, torch);

    fly.update();
    fly.draw(ctx);

    spider.update(width, height, ropes, web, fly, cocoons);
    spider.draw(ctx, torch);

    // Draw cocoons
    cocoons.forEach(c => {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    requestAnimationFrame(animate);
}

init();
animate();
