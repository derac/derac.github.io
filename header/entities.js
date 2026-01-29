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

        const rings = 6;
        this.rings = rings;
        this.strandsCount = strands;

        for (let r = 1; r <= rings; r++) {
            const ringRadius = (radius / rings) * r;
            for (let s = 0; s < strands; s++) {
                const angle = (s / (strands - 1)) * Math.PI * 0.6;

                // Improved skew: Top (smaller s) is longer/more stretched
                // Left side (larger s) is shorter/more compressed
                const t = s / (strands - 1);
                const skewFactor = 1.3 - t * 0.7; // 1.3 at top, 0.6 at side
                const rRadius = ringRadius * skewFactor;

                const px = x - Math.cos(angle) * rRadius;
                const py = y + Math.sin(angle) * rRadius;

                // Anchor points at the outer ring or near boundaries
                const isOuter = r === rings;
                const isFixed = isOuter && (s === 0 || s === strands - 1 || py < 5 || px > x - 5);
                const p = new Point(px, py, isFixed);
                this.points.push(p);

                // Radial constraints (center to ring 1, or ring n to ring n+1)
                if (r === 1) {
                    this.constraints.push(new Constraint(this.center, p, rRadius));
                } else {
                    const prevRingStart = 1 + (r - 2) * strands;
                    const prevP = this.points[prevRingStart + s];
                    const dist = Math.hypot(p.x - prevP.x, p.y - prevP.y);
                    this.constraints.push(new Constraint(prevP, p, dist));
                }

                // Ring constraints (connecting points within the same ring)
                if (s > 0) {
                    const prevInRing = this.points[this.points.length - 2];
                    const dist = Math.hypot(p.x - prevInRing.x, p.y - prevInRing.y);
                    this.constraints.push(new Constraint(prevInRing, p, dist));
                }
            }
        }
    }

    update() {
        this.points.forEach(p => p.update());
        for (let i = 0; i < 6; i++) { // Slightly more iterations for stability
            this.constraints.forEach(c => c.resolve());
        }
    }

    draw(ctx, torch) {
        const dx = this.center.x - torch.x;
        const dy = this.center.y - torch.y;
        const dist = Math.hypot(dx, dy);
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        ctx.save();

        // 1. Draw Radiating Lines (Strands) first
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + light * 0.15})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let s = 0; s < this.strandsCount; s++) {
            const p = this.points[1 + (this.rings - 1) * this.strandsCount + s];
            ctx.moveTo(this.center.x, this.center.y);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        // 2. Draw Ribs/Rings with smooth arcs and light glow
        ctx.shadowColor = `rgba(255, 230, 150, ${light * 0.2})`;
        ctx.shadowBlur = 2 * light;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + light * 0.3})`;
        ctx.lineWidth = 0.8;

        for (let r = 1; r <= this.rings; r++) {
            ctx.beginPath();
            const startIdx = 1 + (r - 1) * this.strandsCount;
            const startP = this.points[startIdx];
            ctx.moveTo(startP.x, startP.y);

            for (let s = 0; s < this.strandsCount - 1; s++) {
                const p1 = this.points[startIdx + s];
                const p2 = this.points[startIdx + s + 1];

                const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                const midX = (p1.x + p2.x) / 2;
                // Subtle sag: proportional to distance but less extreme
                const sag = d * 0.12;
                const midY = (p1.y + p2.y) / 2 + sag;

                ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
            }
            ctx.stroke();
        }

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
            // Find the closest point in the web to stay attached to
            if (!this.caughtPoint) {
                let minDist = Infinity;
                this.web.points.forEach(p => {
                    const d = Math.hypot(p.x - this.x, p.y - this.y);
                    if (d < minDist) {
                        minDist = d;
                        this.caughtPoint = p;
                    }
                });
            }

            if (this.caughtPoint) {
                this.x = this.caughtPoint.x;
                this.y = this.caughtPoint.y;
            }

            this.angle += 0.25;
            this.x += Math.sin(this.angle) * 1;
            this.y += Math.cos(this.angle) * 1;

            // If the mouse hits the caught fly with enough speed, bat it away!
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const dist = Math.hypot(dx, dy);
            const mouseSpeed = Math.hypot(mouse.vx, mouse.vy);

            if (dist < 40 && mouseSpeed > 10) {
                this.isCaught = false;
                this.caughtPoint = null;
                this.vx = mouse.vx * 0.8;
                this.vy = mouse.vy * 0.8;
            }
            return;
        }

        // Bat away even if not caught
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        const mouseSpeed = Math.hypot(mouse.vx, mouse.vy);

        if (dist < 30 && mouseSpeed > 15) {
            this.vx = mouse.vx * 0.5;
            this.vy = mouse.vy * 0.5;
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vy += (Math.random() - 0.5) * 0.5;
        this.vx += (Math.random() - 0.5) * 0.25;

        const speed = Math.abs(this.vx);
        const sign = Math.sign(this.vx) || 1;
        if (speed < 0.5) this.vx = 0.5 * sign;
        if (speed > 2.5 && !this.isCaught) this.vx = 2.5 * sign;

        // Air resistance for batted flies
        this.vx *= 0.99;
        this.vy *= 0.99;

        this.web.points.forEach(p => {
            if (Math.hypot(p.x - this.x, p.y - this.y) < 20) {
                this.isCaught = true;
                this.caughtPoint = p;
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

export class RockText {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.title = "My Blog";
        this.subtitle = "Derac's thoughts and projects";
        this.baseX = width / 2;
        this.baseY = height / 2;

        // Pre-generate stable seeds for "cracks" and "jitter"
        this.cracks = [];
        for (let i = 0; i < 40; i++) {
            this.cracks.push({
                x: (Math.random() - 0.5) * 450,
                y: (Math.random() - 0.5) * 120,
                size: 5 + Math.random() * 15,
                angle: Math.random() * Math.PI * 2
            });
        }

        // Pre-generate stable jitter for title and rock strip
        this.titleJitter = [];
        for (let i = 0; i < 15; i++) {
            this.titleJitter.push({
                x: (Math.random() - 0.5) * 4,
                y: (Math.random() - 0.5) * 4
            });
        }

        this.stripPoints = [];
        const pts = 16;
        for (let i = 0; i < pts; i++) {
            this.stripPoints.push({
                angle: (i / pts) * Math.PI * 2,
                rxOffset: (Math.random() - 0.5) * 12,
                ryOffset: (Math.random() - 0.5) * 10
            });
        }
    }

    draw(ctx, torch) {
        const x = this.baseX;
        const y = this.baseY;

        const dx = torch.x - x;
        const dy = torch.y - y;
        const dist = Math.hypot(dx, dy);
        const nx = dx / dist;
        const ny = dy / dist;
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const titleFont = '6rem "Piedra", serif'; // Used Piedra for rocky look
        ctx.font = titleFont;

        // 1. Draw 3D Extrusion (Stone Block)
        const depth = 14;
        for (let i = depth; i > 0; i--) {
            const ox = -nx * i * 1.3;
            const oy = -ny * i * 1.3;

            // Use stable jitter to roughen the extrusion sides
            const jitterIdx = i % this.titleJitter.length;
            const j = this.titleJitter[jitterIdx];

            const sideVal = 35 + light * 25 - (i / depth) * 12;
            ctx.fillStyle = `rgb(${sideVal}, ${sideVal}, ${sideVal + 8})`;
            ctx.fillText(this.title, x + ox + j.x, y + oy + j.y - 30);
        }

        // 2. Main Surface (Top)
        const topVal = 130 + light * 110;
        ctx.fillStyle = `rgb(${topVal}, ${topVal - 3}, ${topVal - 8})`;

        // Roughen the top edges predictably
        for (let k = 0; k < 3; k++) {
            const j = this.titleJitter[k];
            ctx.fillText(this.title, x + j.x * 0.5, y + j.y * 0.5 - 30);
        }

        // 3. Procedural Cracks & Nicks
        ctx.lineJoin = 'round';
        this.cracks.forEach((c) => {
            // Simple check to see if crack is near the title or strip
            const cy_title = y + c.y - 30;
            const cy_strip = y + 60 + c.y * 0.3; // Scaled for strip height

            // Cracks on title
            if (Math.abs(c.x) < 280 && Math.abs(c.y) < 60) {
                this.drawCrack(ctx, x + c.x, cy_title, c, nx, ny, light);
            }
        });

        // 4. Subtitle on Chiseled Rock Strip
        const subFont = '700 1.4rem "MedievalSharp", cursive'; // Used MedievalSharp for etched look
        ctx.font = subFont;
        const subWidth = ctx.measureText(this.subtitle).width + 80;
        const subHeight = 50;
        const subY = y + 60;

        // Draw stable irregular strip
        ctx.fillStyle = `rgb(${25 + light * 35}, ${27 + light * 35}, ${30 + light * 35})`;
        ctx.beginPath();
        this.stripPoints.forEach((p, i) => {
            const px = x + Math.cos(p.angle) * (subWidth / 2 + p.rxOffset);
            const py = subY + Math.sin(p.angle) * (subHeight / 2 + p.ryOffset);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();

        // High-contrast chiseled edges
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + light * 0.4})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // --- Advanced Etching Effect ---
        // 1. Inner Shadow (Top-Left bevel)
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillText(this.subtitle, x - 1.5, subY - 1.5);

        // 2. Lower Highlight (Bottom-Right glow from "inside" the cut)
        if (light > 0.2) {
            ctx.fillStyle = `rgba(255, 255, 255, ${light * 0.25})`;
            ctx.fillText(this.subtitle, x + 1, subY + 1);
        }

        // 3. Main Etched Content (Deep color)
        const etchingColor = `rgb(${80 + light * 60}, ${82 + light * 60}, ${85 + light * 60})`;
        ctx.fillStyle = etchingColor;
        ctx.fillText(this.subtitle, x, subY);
        ctx.restore();

        ctx.restore();
    }

    drawCrack(ctx, cx, cy, c, nx, ny, light) {
        // Shadow part of crack
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.4 + light * 0.4})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(c.angle) * c.size, cy + Math.sin(c.angle) * c.size);
        ctx.stroke();

        // Highlight edge of crack
        if (light > 0.3) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${light * 0.4})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(cx - nx * 1.5, cy - ny * 1.5);
            ctx.lineTo(cx - nx * 1.5 + Math.cos(c.angle) * c.size, cy - ny * 1.5 + Math.sin(c.angle) * c.size);
            ctx.stroke();
        }
    }
}
