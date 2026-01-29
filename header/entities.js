import { config, mouse } from './config.js';
import { Point, Constraint } from './physics.js';

export class Rope {
    constructor(p1Fixed, p2Fixed, segments, totalLength) {
        this.points = [];
        this.constraints = [];
        const segmentLength = totalLength / segments;

        const startX = p1Fixed.x;
        const startY = p1Fixed.y;
        const endX = p2Fixed.x;
        const endY = p2Fixed.y;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = startX + (endX - startX) * t;
            const y = startY + (endY - startY) * t;
            const isFixed = (i === 0 || i === segments);
            const p = new Point(x, y, isFixed);
            if (isFixed) {
                p.x = i === 0 ? startX : endX;
                p.y = i === 0 ? startY : endY;
            }
            this.points.push(p);

            if (i > 0) {
                this.constraints.push(new Constraint(this.points[i - 1], this.points[i], segmentLength));
            }
        }
    }

    update() {
        this.points.forEach(p => p.update());
        for (let i = 0; i < 5; i++) {
            this.constraints.forEach(c => c.resolve());
        }
    }

    draw(ctx, torch) {
        const dx = (this.points[0].x + this.points[this.points.length - 1].x) / 2 - torch.x;
        const dy = (this.points[0].y + this.points[this.points.length - 1].y) / 2 - torch.y;
        const dist = Math.hypot(dx, dy);
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        ctx.save();
        ctx.shadowColor = `rgba(255, 230, 150, ${light * 0.5})`;
        ctx.shadowBlur = 4 * light;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + light * 0.4})`;
        ctx.lineWidth = 1 + light;
        ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length - 1; i++) {
            const p = this.points[i];
            const next = this.points[i + 1];
            const xc = (p.x + next.x) / 2;
            const yc = (p.y + next.y) / 2;
            ctx.quadraticCurveTo(p.x, p.y, xc, yc);
        }
        const last = this.points[this.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + light * 0.6})`;
        ctx.lineWidth = 0.5 + light * 0.3;
        ctx.stroke();
        ctx.restore();
    }
}

export class Web {
    constructor(x, y, radius, strands) {
        this.center = new Point(x, y, true);
        this.points = [this.center];
        this.constraints = [];
        this.strands = strands;

        // Create anchor strands first (longer, fixed at the ends)
        for (let s = 0; s < strands; s++) {
            const angle = (s / (strands - 1)) * Math.PI * 0.7 + (Math.random() - 0.5) * 0.2;
            const length = radius * (0.8 + Math.random() * 0.4);

            let prev = this.center;
            const segments = 3;
            for (let i = 1; i <= segments; i++) {
                const segLen = length / segments;
                const dist = segLen * i;
                const isFixed = (i === segments && (s === 0 || s === strands - 1 || Math.random() > 0.7));

                const px = x - Math.cos(angle) * dist;
                const py = y + Math.sin(angle) * dist;

                const p = new Point(px, py, isFixed);
                this.points.push(p);
                this.constraints.push(new Constraint(prev, p, segLen));
                prev = p;
            }
        }

        // Add rings (inner spiral-ish structures)
        const rings = 5;
        for (let r = 1; r < rings; r++) {
            const ringPos = r / rings;
            for (let s = 0; s < strands - 1; s++) {
                // Find points on adjacent strands at similar "depth"
                const idx1 = 1 + s * 3 + Math.floor(ringPos * 3);
                const idx2 = 1 + (s + 1) * 3 + Math.floor(ringPos * 3);

                if (this.points[idx1] && this.points[idx2]) {
                    const p1 = this.points[idx1];
                    const p2 = this.points[idx2];
                    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) * (1.1 + Math.random() * 0.2);
                    this.constraints.push(new Constraint(p1, p2, dist));
                }
            }
        }
    }

    update() {
        // Mouse interaction: Pull on web points
        if (mouse.down) {
            this.points.forEach(p => {
                if (!p.fixed) {
                    const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
                    if (d < 50) {
                        p.x += (mouse.x - p.x) * 0.2;
                        p.y += (mouse.y - p.y) * 0.2;
                    }
                }
            });
        }

        this.points.forEach(p => p.update());
        for (let i = 0; i < 5; i++) {
            this.constraints.forEach(c => c.resolve());
        }
    }

    draw(ctx, torch) {
        const dx = this.center.x - torch.x;
        const dy = this.center.y - torch.y;
        const dist = Math.hypot(dx, dy);
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        ctx.save();
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + light * 0.4})`;
        ctx.lineWidth = 0.5;

        // Draw radial strands
        ctx.beginPath();
        this.constraints.forEach(c => {
            // Only draw constraints that are part of the radial strands (not rings)
            // for a cleaner look, or just draw all constraints
            ctx.moveTo(c.p1.x, c.p1.y);
            ctx.lineTo(c.p2.x, c.p2.y);
        });
        ctx.stroke();

        // Draw more organic curves for the rings
        ctx.shadowColor = `rgba(255, 230, 150, ${light * 0.3})`;
        ctx.shadowBlur = 4 * light;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + light * 0.2})`;

        // Redraw rings specifically with curves
        const segments = 3;
        const strands = this.strands;
        const rings = 5;
        for (let r = 1; r < rings; r++) {
            const ringPos = r / rings;
            for (let s = 0; s < strands - 1; s++) {
                const idx1 = 1 + s * segments + Math.floor(ringPos * segments);
                const idx2 = 1 + (s + 1) * segments + Math.floor(ringPos * segments);
                if (this.points[idx1] && this.points[idx2]) {
                    const p1 = this.points[idx1];
                    const p2 = this.points[idx2];
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2 + (r * 2);
                    ctx.moveTo(p1.x, p1.y);
                    ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
                }
            }
        }
        ctx.stroke();
        ctx.restore();
    }
}

export class Torch {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.flicker = 1;
        this.time = 0;
    }

    update() {
        this.time += 0.1;
        this.flicker = 0.9 + Math.sin(this.time) * 0.05 + Math.random() * 0.05;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Backplate on the wall (right side)
        const wallX = 45;
        const bronzeGradient = ctx.createLinearGradient(wallX - 10, 0, wallX + 10, 0);
        bronzeGradient.addColorStop(0, '#634a30');
        bronzeGradient.addColorStop(0.5, '#cd7f32');
        bronzeGradient.addColorStop(1, '#634a30');

        ctx.fillStyle = bronzeGradient;
        ctx.beginPath();
        ctx.roundRect(wallX - 8, 5, 16, 60, 4);
        ctx.fill();

        // Connecting Bracket Tube (to wall)
        ctx.beginPath();
        ctx.strokeStyle = '#8b5a2b';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.moveTo(0, 35);
        ctx.quadraticCurveTo(wallX * 0.3, 40, wallX - 5, 30);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = '#cd7f32';
        ctx.lineWidth = 2;
        ctx.moveTo(0, 35);
        ctx.quadraticCurveTo(wallX * 0.3, 40, wallX - 5, 30);
        ctx.stroke();

        // Torch Handle
        ctx.fillStyle = '#4a3728';
        ctx.fillRect(-5, 0, 10, 40);

        // Metal bands on torch
        ctx.strokeStyle = '#cd7f32';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, 5);
        ctx.lineTo(6, 5);
        ctx.moveTo(-6, 35);
        ctx.lineTo(6, 35);
        ctx.stroke();

        const gradient = ctx.createRadialGradient(0, 0, 5, 0, 0, 40 * this.flicker);
        gradient.addColorStop(0, 'rgba(255, 200, 50, 0.8)');
        gradient.addColorStop(0.3, 'rgba(255, 100, 0, 0.4)');
        gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, 40 * this.flicker, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff7e6';
        ctx.beginPath();
        ctx.ellipse(0, -5, 8 * this.flicker, 12 * this.flicker, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

export class Fly {
    constructor(width, height, web) {
        this.width = width;
        this.height = height;
        this.web = web;
        this.reset();
    }

    reset() {
        this.x = 10;
        this.y = Math.random() * this.height;
        this.vx = 1 + Math.random() * 1;
        this.vy = (Math.random() - 0.5) * 2;
        this.isCaught = false;
        this.isCarried = false;
        this.angle = 0;
    }

    update() {
        if (this.isCarried) return;

        if (this.isCaught) {
            this.angle += 0.25;
            this.x += Math.sin(this.angle) * 1;
            this.y += Math.cos(this.angle) * 1;
            return;
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vy += (Math.random() - 0.5) * 0.5;
        this.vx += (Math.random() - 0.5) * 0.25;

        const speed = Math.abs(this.vx);
        const sign = Math.sign(this.vx) || 1;
        if (speed < 0.5) this.vx = 0.5 * sign;
        if (speed > 2.5) this.vx = 2.5 * sign;

        this.web.points.forEach(p => {
            if (Math.hypot(p.x - this.x, p.y - this.y) < 20) {
                this.isCaught = true;
                this.vx = 0;
                this.vy = 0;
            }
        });

        if (this.x < 0) {
            this.x = 0;
            this.vx = Math.max(0, this.vx);
        } else if (this.x > this.width) {
            this.x = this.width;
            this.vx = Math.min(0, this.vx);
        }

        if (this.y < 0) {
            this.y = 0;
            this.vy = Math.max(0, this.vy);
        } else if (this.y > this.height) {
            this.y = this.height;
            this.vy = Math.min(0, this.vy);
        }
    }

    draw(ctx) {
        if (this.isCarried) return;
        ctx.save();
        ctx.translate(this.x, this.y);

        ctx.fillStyle = 'rgba(200, 200, 255, 0.4)';
        const wingSize = 5 + Math.sin(Date.now() * 0.05) * 2;
        ctx.beginPath();
        ctx.ellipse(-3, -2, wingSize, 3, 0.5, 0, Math.PI * 2);
        ctx.ellipse(3, -2, wingSize, 3, -0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}
