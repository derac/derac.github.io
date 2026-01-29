import { config, mouse } from './config.js';
import { Point } from './physics.js';

export class Spider {
    constructor(width) {
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
                        if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 60) {
                            this.targetRope = rope;
                            this.targetPointIdx = idx;
                            snapped = true;
                            this.returningHome = true;
                        }
                    });
                });
                web.points.forEach(p => {
                    if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 60) {
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
            if (Math.hypot(dx, dy) < 40 && mouse.down) {
                this.isGrabbed = true;
            }

            if (fly.isCaught && !this.isCarrying) {
                this.targetFly = fly;
            }

            if (this.attachedToWeb) {
                const targetPoint = this.targetFly ? { x: this.targetFly.x, y: this.targetFly.y } : web.center;
                const tx = targetPoint.x + (this.targetFly ? 0 : -20);
                const ty = targetPoint.y + (this.targetFly ? 0 : 20);

                const d = Math.hypot(tx - this.point.x, ty - this.point.y);
                if (d > 5) {
                    this.point.x += (tx - this.point.x) * 0.0075;
                    this.point.y += (ty - this.point.y) * 0.0075;
                } else {
                    this.point.x = tx;
                    this.point.y = ty;

                    if (this.targetFly && this.targetFly.isCaught) {
                        this.isCarrying = true;
                        this.targetFly.isCaught = false;
                        this.targetFly.isCarried = true;
                        this.targetFly = null;
                        this.returningHome = true;
                    } else if (this.isCarrying) {
                        cocoons.push({
                            x: web.center.x + (Math.random() - 0.5) * 40,
                            y: web.center.y + (Math.random() - 0.5) * 40,
                            rotation: Math.random() * Math.PI
                        });
                        this.isCarrying = false;
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
                            if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 40) {
                                this.targetRope = rope;
                                this.targetPointIdx = idx;
                            }
                        });
                    });
                    this.point.update();
                } else {
                    const target = this.targetRope.points[this.targetPointIdx];
                    this.point.x += (target.x - this.point.x) * 0.0125;
                    this.point.y += (target.y - this.point.y) * 0.0125;

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
                                    if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 30) {
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
                        if (Math.hypot(p.x - this.point.x, p.y - this.point.y) < 50) {
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

        this.legPhase += (this.returningHome || this.targetFly) ? 0.06 : 0.025;
        this.feet.forEach((foot, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const reach = config.spiderSize * 3;
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
                foot.x += (closest.x - foot.x) * 0.3;
                foot.y += (closest.y - foot.y) * 0.3;
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
                    foot.x += (boundClosestX - foot.x) * 0.3;
                    foot.y += (boundClosestY - foot.y) * 0.3;
                } else {
                    const idleRadius = 10;
                    const circleX = Math.cos(this.legPhase + i * 0.8) * idleRadius;
                    const circleY = Math.sin(this.legPhase + i * 0.8) * idleRadius;

                    foot.x += (idealX + circleX - foot.x) * 0.1;
                    foot.y += (idealY + circleY - foot.y) * 0.1;
                }
            }
        });

        this.point.x = Math.max(0, Math.min(width, this.point.x));
        if (this.point.x <= 0 || this.point.x >= width) {
            this.point.oldX = this.point.x;
        }

        // Transition to ceiling walk if at top end of a rope
        if (this.targetRope && this.point.y < 40) {
            const target = this.targetRope.points[this.targetPointIdx];
            if (target.y < 15) {
                this.lastRope = this.targetRope;
                this.targetRope = null;
                this.point.y = 10;
                this.junctionCooldown = 120; // 2 second immunity
            }
        }

        if ((this.point.y > height - 15 || this.point.x > width - 15 || this.point.x < 15 || this.point.y < 15) && !this.attachedToWeb && !this.targetRope && !this.isGrabbed) {
            this.grounded = true;

            if (this.point.y < 15) {
                this.point.y = 10;
                this.point.x += 5; // Fast crawl right toward web
            } else if (this.point.y > height - 15) {
                this.point.y = height - 10;
                this.point.x += 2;
            } else if (this.point.x > width - 15) {
                this.point.x = width - 10;
                this.point.y -= 2;
            } else if (this.point.x < 15) {
                this.point.x = 10;
                this.point.y -= 2;
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

        ctx.save();
        ctx.strokeStyle = `rgba(180, 180, 200, ${0.3 + light * 0.7})`;
        ctx.lineWidth = 2.5;
        this.feet.forEach((foot, i) => {
            const shoulderX = x + Math.cos((i / 8) * Math.PI * 2) * (config.spiderSize * 0.8);
            const shoulderY = y + Math.sin((i / 8) * Math.PI * 2) * (config.spiderSize * 0.8);
            const midX = (shoulderX + foot.x) / 2;
            const midY = (shoulderY + foot.y) / 2 - 15;

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
        ctx.arc(x, y, config.spiderSize, 0, Math.PI * 2);
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

        ctx.fillStyle = `rgba(255, 100, 100, ${0.8 + light * 0.2})`;
        ctx.shadowBlur = 8 * light;
        ctx.shadowColor = '#ff3e3e';
        ctx.beginPath();
        ctx.arc(x - 4, y - 4, 3, 0, Math.PI * 2);
        ctx.arc(x + 4, y - 4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
