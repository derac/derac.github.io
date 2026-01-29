import { config, mouse } from './config.js';
import { Point } from './physics.js';

export class Spider {
    constructor(width, scale = 1) {
        this.scale = scale;
        this.point = new Point(width, 0);
        this.isGrabbed = false;
        this.legPhase = 0;
        this.targetRope = null;
        this.targetPointIdx = 0;
        this.attachedToWeb = true;
        this.returningHome = false;
        this.moveDelay = 0;
        this.targetFly = null;
        this.isCarrying = false;
        this.lastRope = null;
        this.junctionCooldown = 0;
        this.grounded = false;

        // IK targets for feet
        this.feet = Array.from({ length: 8 }, () => ({ x: 0, y: 0, target: null }));
    }

    update(width, height, ropes, web, fly, cocoons) {
        if (this.isGrabbed) {
            this.point.x = mouse.x;
            this.point.y = mouse.y;
            this.point.oldX = mouse.x;
            this.point.oldY = mouse.y;
            this.attachedToWeb = false;
            this.targetRope = null;
            this.returningHome = false;
            this.targetFly = null;
            if (!mouse.down) {
                this.isGrabbed = false;
                let snapped = false;
                ropes.forEach(rope => {
                    rope.points.forEach((p, idx) => {
                        if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 150) {
                            this.targetRope = rope;
                            this.targetPointIdx = idx;
                            snapped = true;
                            this.returningHome = true;
                        }
                    });
                });
                web.points.forEach(p => {
                    if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 150) {
                        this.attachedToWeb = true;
                        snapped = true;
                    }
                });

                if (!snapped) {
                    this.point.oldX = mouse.x - (mouse.x - this.point.oldX) * 2;
                    this.point.oldY = mouse.y - (mouse.y - this.point.oldY) * 2;
                }
            }
        } else {
            const dx = this.point.x - mouse.x;
            const dy = this.point.y - mouse.y;
            if (Math.hypot(dx, dy) < 100 && mouse.down) {
                this.isGrabbed = true;
            }

            if (fly.isCaught && !this.isCarrying) {
                this.targetFly = fly;
            }

            if (this.attachedToWeb) {
                let targetPoint = web.center;
                if (this.targetFly) {
                    targetPoint = { x: this.targetFly.x, y: this.targetFly.y };
                } else if (this.isCarrying && this.cocoonTarget) {
                    targetPoint = this.cocoonTarget;
                }

                const tx = targetPoint.x;
                const ty = targetPoint.y;

                const d = Math.hypot(tx - this.point.x, ty - this.point.y);
                if (d > 12.5) {
                    this.point.x += (tx - this.point.x) * 0.02;
                    this.point.y += (ty - this.point.y) * 0.02;
                } else {
                    this.point.x = tx;
                    this.point.y = ty;

                    if (this.targetFly && this.targetFly.isCaught) {
                        this.isCarrying = true;
                        this.targetFly.isCaught = false;
                        this.targetFly.isCarried = true;
                        this.targetFly = null;
                        const validPoints = web.points.filter(p => !p.isFixed);
                        this.cocoonTarget = validPoints.length > 0
                            ? validPoints[Math.floor(Math.random() * validPoints.length)]
                            : web.points[Math.floor(Math.random() * web.points.length)];
                        this.returningHome = true;
                    } else if (this.isCarrying && this.cocoonTarget) {
                        const targetPoint = this.cocoonTarget;
                        targetPoint.cocoonCount = (targetPoint.cocoonCount || 0) + 1;

                        cocoons.push({
                            point: targetPoint,
                            index: targetPoint.cocoonCount,
                            rotation: Math.random() * Math.PI
                        });
                        this.isCarrying = false;
                        this.cocoonTarget = null;
                        fly.reset();
                    }
                }
                this.point.oldX = this.point.x;
                this.point.oldY = this.point.y;
            } else {
                if (!this.targetRope) {
                    ropes.forEach(rope => {
                        if (rope === this.lastRope && this.junctionCooldown > 0) return;
                        rope.points.forEach((p, idx) => {
                            if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 100) {
                                this.targetRope = rope;
                                this.targetPointIdx = idx;
                            }
                        });
                    });
                    this.point.update();
                } else {
                    const target = this.targetRope.points[this.targetPointIdx];
                    this.point.x += (target.x - this.point.x) * 0.03;
                    this.point.y += (target.y - this.point.y) * 0.03;

                    this.moveDelay++;
                    if (this.moveDelay > 10) {
                        this.moveDelay = 0;
                        if (this.returningHome) {
                            const p0 = this.targetRope.points[0];
                            const pN = this.targetRope.points[this.targetRope.points.length - 1];

                            if (p0.x > pN.x) {
                                if (this.targetPointIdx > 0) this.targetPointIdx--;
                            } else {
                                if (this.targetPointIdx < this.targetRope.points.length - 1) this.targetPointIdx++;
                            }
                        } else if (Math.random() > 0.9) {
                            this.targetPointIdx = Math.max(0, Math.min(this.targetRope.points.length - 1, this.targetPointIdx + (Math.random() > 0.5 ? 1 : -1)));
                            if (Math.random() > 0.8) this.returningHome = true;
                        }

                        if (this.junctionCooldown > 0) {
                            this.junctionCooldown--;
                        } else {
                            let foundNewRoute = false;
                            for (let rope of ropes) {
                                if (rope === this.targetRope || rope === this.lastRope) continue;
                                for (let idx = 0; idx < rope.points.length; idx++) {
                                    const p = rope.points[idx];
                                    if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 75) {
                                        this.lastRope = this.targetRope;
                                        this.targetRope = rope;
                                        this.targetPointIdx = idx;
                                        this.junctionCooldown = 60;
                                        foundNewRoute = true;
                                        break;
                                    }
                                }
                                if (foundNewRoute) break;
                            }
                        }
                    }

                    let nearWeb = false;
                    web.points.forEach(p => {
                        if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 125) {
                            nearWeb = true;
                        }
                    });
                    if (nearWeb) {
                        this.attachedToWeb = true;
                        this.targetRope = null;
                        this.returningHome = (this.isCarrying);
                    }

                    this.point.oldX = this.point.x;
                    this.point.oldY = this.point.y;
                }
            }
        }

        this.legPhase += (this.returningHome || this.targetFly || this.grounded) ? 0.3 : 0.075;
        this.feet.forEach((foot, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const reach = config.spiderSize * 3 * this.scale;
            const idealX = this.point.x + Math.cos(angle) * reach;
            const idealY = this.point.y + Math.sin(angle) * reach;

            let closest = null, minDist = reach;
            ropes.forEach(rope => rope.points.forEach(p => {
                const d = Math.hypot(p.x - idealX, p.y - idealY);
                if (d < minDist) { minDist = d; closest = p; }
            }));

            web.points.forEach(p => {
                const d = Math.hypot(p.x - idealX, p.y - idealY);
                if (d < minDist) { minDist = d; closest = p; }
            });

            if (closest) {
                foot.x += (closest.x - foot.x) * 0.5;
                foot.y += (closest.y - foot.y) * 0.5;
            } else {
                let boundClosestX = idealX, boundClosestY = idealY;
                let boundMinDist = reach;

                const bounds = [
                    { x: 0, y: idealY }, { x: width, y: idealY },
                    { x: idealX, y: 0 }, { x: idealX, y: height }
                ];
                bounds.forEach(b => {
                    const d = Math.hypot(b.x - idealX, b.y - idealY);
                    if (d < boundMinDist) { boundMinDist = d; boundClosestX = b.x; boundClosestY = b.y; }
                });

                if (boundMinDist < reach) {
                    foot.x += (boundClosestX - foot.x) * 0.5;
                    foot.y += (boundClosestY - foot.y) * 0.5;
                } else {
                    const idleRadius = 10 * this.scale;
                    const circleX = Math.cos(this.legPhase + i * 0.8) * idleRadius;
                    const circleY = Math.sin(this.legPhase + i * 0.8) * idleRadius;

                    foot.x += (idealX + circleX - foot.x) * 0.2;
                    foot.y += (idealY + circleY - foot.y) * 0.2;
                }
            }
        });

        this.point.x = Math.max(0, Math.min(width, this.point.x));
        if (this.point.x <= 0 || this.point.x >= width) {
            this.point.oldX = this.point.x;
        }

        // Transition to ceiling walk if at top end of a rope
        if (this.targetRope && this.point.y < 100) {
            const target = this.targetRope.points[this.targetPointIdx];
            if (target.y < 37.5) {
                this.lastRope = this.targetRope;
                this.targetRope = null;
                this.point.y = 25;
                this.junctionCooldown = 120; // 2 second immunity
            }
        }

        // Dynamic boundary offset (half body size / radius)
        const bodyRadius = config.spiderSize * this.scale;
        const snapOffset = bodyRadius;
        const threshold = bodyRadius + 12.5;

        if ((this.point.y > height - threshold || this.point.x > width - threshold || this.point.y < threshold) && !this.attachedToWeb && !this.targetRope && !this.isGrabbed) {
            this.grounded = true;

            const walkSpeed = 2.5;
            // Add bobbing motion (sine wave based on legPhase)
            const bob = Math.sin(this.legPhase) * 5;
            const bobOffset = Math.abs(bob);

            if (this.point.y < threshold) {
                // Ceiling
                this.point.y = snapOffset + bobOffset;
                this.point.x += walkSpeed;
            } else if (this.point.x > width - threshold) {
                // Right Wall (Prioritized over floor to allow climbing up corner)
                this.point.x = width - snapOffset - bobOffset;
                this.point.y -= (walkSpeed + config.gravity);
            } else if (this.point.y > height - threshold) {
                // Floor
                this.point.y = height - snapOffset - bobOffset;
                this.point.x += walkSpeed;
            }

            this.point.oldX = this.point.x;
            this.point.oldY = this.point.y;

            ropes.forEach(rope => {
                if (rope === this.lastRope && this.junctionCooldown > 0) return;
                rope.points.forEach((p, idx) => {
                    if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 40) {
                        this.targetRope = rope;
                        this.targetPointIdx = idx;
                        this.grounded = false;
                    }
                });
            });
        } else {
            this.grounded = false;
        }

        if (this.point.y > height + 200) {
            this.attachedToWeb = true;
            this.point.y = web.center.y ? web.center.y : 20;
        }
    }

    draw(ctx, torch) {
        const { x, y } = this.point;
        const dx = x - torch.x;
        const dy = y - torch.y;
        const dist = Math.hypot(dx, dy);
        const light = Math.max(0.1, 1 - dist / config.lightReach) * torch.flicker;

        const size = config.spiderSize * this.scale;

        ctx.save();
        ctx.strokeStyle = `rgba(180, 180, 200, ${0.3 + light * 0.7})`;
        ctx.lineWidth = 2.5 * this.scale;
        this.feet.forEach((foot, i) => {
            const shoulderX = x + Math.cos((i / 8) * Math.PI * 2) * (size * 0.8);
            const shoulderY = y + Math.sin((i / 8) * Math.PI * 2) * (size * 0.8);
            const midX = (shoulderX + foot.x) / 2;
            const midY = (shoulderY + foot.y) / 2 - 15 * this.scale;

            ctx.beginPath();
            ctx.moveTo(shoulderX, shoulderY);
            ctx.lineTo(midX, midY);
            ctx.lineTo(foot.x, foot.y);
            ctx.stroke();
        });

        ctx.fillStyle = `rgb(${40 + light * 140}, ${40 + light * 140}, ${50 + light * 160})`;
        ctx.shadowBlur = 15 * light;
        ctx.shadowColor = 'rgba(255, 230, 150, 0.8)';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        if (this.isCarrying) {
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(x, y + 10, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 5, y + 5);
            ctx.lineTo(x + 5, y + 15);
            ctx.moveTo(x + 5, y + 5);
            ctx.lineTo(x - 5, y + 15);
            ctx.stroke();
        }

        // Multi-Eye Cluster (8 eyes: 2 main, 2 side, 4 small top)
        ctx.fillStyle = '#000'; // Black eyes
        const eyeBaseX = x;
        const eyeBaseY = y - 2 * this.scale;

        const eyes = [
            // Main pair (Large)
            { x: -5, y: -4, r: 4 }, { x: 5, y: -4, r: 4 },
            // Side pair (Medium)
            { x: -11, y: -5, r: 2.5 }, { x: 11, y: -5, r: 2.5 },
            // Top/Small cluster
            { x: -3, y: -10, r: 1.5 }, { x: 3, y: -10, r: 1.5 },
            { x: -7, y: -8, r: 1.5 }, { x: 7, y: -8, r: 1.5 }
        ];

        eyes.forEach(eye => {
            const ex = eyeBaseX + eye.x * this.scale;
            const ey = eyeBaseY + eye.y * this.scale;
            const er = eye.r * this.scale;

            // Eye ball
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(ex, ey, er, 0, Math.PI * 2);
            ctx.fill();

            // Specular highlight (Shiny!)
            ctx.fillStyle = `rgba(255, 255, 255, ${0.7 + light * 0.3})`;
            ctx.beginPath();
            ctx.arc(ex - er * 0.3, ey - er * 0.3, er * 0.4, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }
}
