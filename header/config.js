export const config = {
    gravity: 1.5,
    friction: 0.98,
    ropeStiffness: 0.2,
    ropeSegments: 20,
    ropeDistance: 37.5,
    ropeCount: 3,
    spiderSize: 37.5,
    webComplexity: 10,
    webRadius: 700,
    torchSize: 100,
    lightReach: 1500
};

export const mouse = { x: -100, y: -100, vx: 0, vy: 0, down: false };
export const pointers = new Map(); // Tracks multiple interaction points by ID
