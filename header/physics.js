import { config, mouse } from './config.js';

export class Point {
    constructor(x, y, isFixed = false) {
        this.x = x;
        this.y = y;
        this.oldX = x;
        this.oldY = y;
        this.isFixed = isFixed;
    }

    update() {
        if (this.isFixed) return;

        const vx = (this.x - this.oldX) * config.friction;
        const vy = (this.y - this.oldY) * config.friction;

        this.oldX = this.x;
        this.oldY = this.y;

        this.x += vx;
        this.y += vy + config.gravity;

        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 50 && mouse.down) {
            this.x += (mouse.x - this.x) * 0.1;
            this.y += (mouse.y - this.y) * 0.1;
        }
    }
}

export class Constraint {
    constructor(p1, p2, length) {
        this.p1 = p1;
        this.p2 = p2;
        this.length = length;
    }

    resolve() {
        const dx = this.p2.x - this.p1.x;
        const dy = this.p2.y - this.p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const diff = (this.length - dist) / dist;

        const offsetX = dx * diff * 0.5;
        const offsetY = dy * diff * 0.5;

        if (!this.p1.isFixed) {
            this.p1.x -= offsetX;
            this.p1.y -= offsetY;
        }
        if (!this.p2.isFixed) {
            this.p2.x += offsetX;
            this.p2.y += offsetY;
        }
    }
}
