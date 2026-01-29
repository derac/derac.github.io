export const config = {
    gravity: 0.6,
    friction: 0.98,
    ropeStiffness: 0.2,
    ropeSegments: 20,
    ropeDistance: 15,
    ropeCount: 10,
    spiderSize: 15,
    webComplexity: 12,
    webRadius: 280,
    torchSize: 40,
    lightReach: 600
};

export const mouse = { x: -100, y: -100, vx: 0, vy: 0, down: false };
export const pointers = new Map(); // Tracks multiple interaction points by ID
