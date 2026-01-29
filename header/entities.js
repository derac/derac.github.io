import { config, mouse, pointers } from './config.js';
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

    update(height) {
        this.points.forEach(p => p.update());
        for (let i = 0; i < 5; i++) {
            this.constraints.forEach(c => c.resolve());
        }

        // Floor collision
        if (height) {
            this.points.forEach(p => {
                if (p.y > height) {
                    p.y = height;
                    p.oldY = p.y; // Stop vertical momentum
                }
            });
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
                const isBoundary = py < 10 || px > x - 10;
                // Explicitly fix the first and last strands (edges)
                const isFixed = isBoundary || s === 0 || s === strands - 1;
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
    constructor(x, y, scale = 1) {
        this.x = x;
        this.y = y;
        this.scale = scale;
        this.flicker = 1;
        this.time = 0;
    }

    update() {
        this.time += 0.1;
        // Composite waves for "wind" or base fluctuation
        const wave1 = Math.sin(this.time * 2) * 0.03;
        const wave2 = Math.sin(this.time * 3.7) * 0.03;
        const wave3 = Math.sin(this.time * 5.1) * 0.02;

        // Sharp random jitter
        const jitter = (Math.random() - 0.5) * 0.1;

        // Base intensity + waves + jitter, clamped slightly
        this.flicker = Math.max(0.8, Math.min(1.2, 1.0 + wave1 + wave2 + wave3 + jitter));
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.scale * 2.5, this.scale * 2.5); // Scale the entire torch drawing 2.5x

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

            // If any pointer hits the caught fly with enough speed, bat it away!
            let batted = false;
            for (const p of pointers.values()) {
                const dx = this.x - p.x;
                const dy = this.y - p.y;
                const dist = Math.hypot(dx, dy);
                const pSpeed = Math.hypot(p.vx, p.vy);

                if (dist < 100 && pSpeed > 25) {
                    this.isCaught = false;
                    this.caughtPoint = null;
                    this.vx = p.vx * 0.8;
                    this.vy = p.vy * 0.8;
                    batted = true;
                    break;
                }
            }
            if (batted) return;
        }

        // Bat away even if not caught
        for (const p of pointers.values()) {
            const dx = this.x - p.x;
            const dy = this.y - p.y;
            const dist = Math.hypot(dx, dy);
            const pSpeed = Math.hypot(p.vx, p.vy);

            if (dist < 75 && pSpeed > 37.5) {
                this.vx = p.vx * 0.5;
                this.vy = p.vy * 0.5;
            }
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vy += (Math.random() - 0.5) * 1.5;
        this.vx += (Math.random() - 0.5) * 0.75;

        const speed = Math.abs(this.vx);
        const sign = Math.sign(this.vx) || 1;
        if (speed < 1.5) this.vx = 1.5 * sign;
        if (speed > 6.0 && !this.isCaught) this.vx = 6.0 * sign;

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

    draw(ctx, torch) {
        if (this.isCarried) return;

        ctx.save();
        ctx.translate(this.x, this.y);

        // Calculate lighting
        const dx = this.x - torch.x;
        const dy = this.y - torch.y;
        const dist = Math.hypot(dx, dy);
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        // Dynamic shadow based on light
        ctx.shadowColor = `rgba(0, 0, 0, ${0.5 * light})`;
        ctx.shadowBlur = 5 * light;

        // Wings with light influence
        ctx.fillStyle = `rgba(${200 + light * 55}, ${200 + light * 55}, 255, ${0.3 + light * 0.3})`;
        const wingSize = 12.5 + Math.sin(Date.now() * 0.05) * 5;
        ctx.beginPath();
        ctx.ellipse(-7.5, -5, wingSize, 7.5, 0.5, 0, Math.PI * 2);
        ctx.ellipse(7.5, -5, wingSize, 7.5, -0.5, 0, Math.PI * 2);
        ctx.fill();

        // Body with light influence
        const bodyColor = Math.floor(17 * light + 20); // getting slightly brighter
        ctx.fillStyle = `rgb(${bodyColor}, ${bodyColor}, ${bodyColor})`;

        // Add a specular highlight if very close to light
        if (light > 0.5) {
            ctx.fillStyle = `rgb(${bodyColor + 40}, ${bodyColor + 40}, ${bodyColor + 40})`;
        }

        ctx.beginPath();
        ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

export class RockText {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.title = "My Blog";
        this.subtitle = "derac's thoughts and projects";
        this.baseX = width / 2;
        this.baseY = height / 2;



        // Pre-generate stable jitter for title and rock strip
        this.titleJitter = [];
        for (let i = 0; i < 15; i++) {
            this.titleJitter.push({
                x: (Math.random() - 0.5) * 10,
                y: (Math.random() - 0.5) * 10
            });
        }

        this.stripPoints = [];
        const pts = 16;
        for (let i = 0; i < pts; i++) {
            this.stripPoints.push({
                angle: (i / pts) * Math.PI * 2,
                rxOffset: (Math.random() - 0.5) * 30,
                ryOffset: (Math.random() - 0.5) * 25
            });
        }
    }

    draw(ctx, torch) {
        const x = this.baseX;
        const y = this.baseY;

        // Dynamic font size logic: Scale with width but enforce minimum
        // Base scale: roughly 15rem at 1000px width (scaled 2.5x)
        const scaleFactor = Math.min(1, Math.max(0.5, this.width / 1000));
        const fontSizeVal = Math.max(8.75, 15 * scaleFactor); // Min 8.75rem

        const dx = torch.x - x;
        const dy = torch.y - y;
        const dist = Math.hypot(dx, dy);
        const nx = dx / dist;
        const ny = dy / dist;
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const titleFont = `${fontSizeVal}rem "Piedra", serif`; // Used Piedra for rocky look
        ctx.font = titleFont;

        // 1. Draw 3D Extrusion (Stone Block)
        const depth = 35;
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



        // 4. Subtitle on Chiseled Rock Strip
        const subScale = Math.min(1, Math.max(0.6, this.width / 1000));
        const subFontSize = 1.4 * subScale;
        const subFont = `700 ${subFontSize}rem "MedievalSharp", cursive`;
        ctx.font = subFont;

        const subWidth = ctx.measureText(this.subtitle).width + 80 * subScale;
        const subHeight = 50 * subScale;
        const subY = y + 60 * subScale;

        // Draw stable irregular strip
        // Lightened the rock strip color significantly
        ctx.fillStyle = `rgb(${75 + light * 45}, ${77 + light * 45}, ${80 + light * 45})`;
        ctx.beginPath();
        this.stripPoints.forEach((p, i) => {
            const px = x + Math.cos(p.angle) * (subWidth / 2 + p.rxOffset * subScale);
            const py = subY + Math.sin(p.angle) * (subHeight / 2 + p.ryOffset * subScale);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();

        // Add Noise/Texture to the strip
        ctx.save();
        ctx.clip(); // Clip to the strip shape
        ctx.fillStyle = `rgba(0, 0, 0, ${0.1 + light * 0.1})`;
        for (let i = 0; i < 30; i++) {
            // Using stable random-ish values based on strip points or index would be better 
            // but for simple noise we can use the pre-generated cracks seeds or generating new ones if strictly needed to be static
            // For now, let's use a simple determined noise
            const nx = x + ((i * 1234.56) % subWidth) - subWidth / 2;
            const ny = subY + ((i * 789.12) % subHeight) - subHeight / 2;
            ctx.fillRect(nx, ny, 2, 2);
        }
        // Add some lighter speckles too
        ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + light * 0.1})`;
        for (let i = 0; i < 20; i++) {
            const nx = x + ((i * 2345.67) % subWidth) - subWidth / 2;
            const ny = subY + ((i * 890.12) % subHeight) - subHeight / 2;
            ctx.fillRect(nx, ny, 1, 1);
        }
        ctx.restore();

        // High-contrast chiseled edges
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + light * 0.5})`; // Slightly lighter edge
        ctx.lineWidth = 2.5 * subScale;
        ctx.stroke();

        // --- Advanced Etching Effect ---
        // 1. Inner Shadow (Top-Left bevel)
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // Reduced opacity
        ctx.fillText(this.subtitle, x - 1.5 * subScale, subY - 1.5 * subScale);

        // 2. Lower Highlight (Bottom-Right glow from "inside" the cut)
        if (light > 0.2) {
            ctx.fillStyle = `rgba(255, 255, 255, ${light * 0.4})`; // Stronger highlight
            ctx.fillText(this.subtitle, x + 1 * subScale, subY + 1 * subScale);
        }

        // 3. Main Etched Content (Deep color)
        // Lightened the text color to match title brightness better
        const etchingColor = `rgb(${150 + light * 80}, ${152 + light * 80}, ${155 + light * 80})`;
        ctx.fillStyle = etchingColor;
        ctx.fillText(this.subtitle, x, subY);
        ctx.restore();

        ctx.restore();

    }


}
