import * as po from "./pixel-operations.js";

canvas = document.getElementById("canvas");
let WIDTH = window.innerWidth;
let HEIGHT = window.innerHeight;
let Grid = new po.InfiniteGrid(canvas, WIDTH, HEIGHT);
let center_point = new po.Pixel(
  -Grid.img_width / 2 + WIDTH / 2,
  -Grid.img_height / 2 + HEIGHT / 2
);

function draw() {
  for (let _ of [...Array(100).keys()]) {
    Grid.set_pixel(
      Math.floor(Math.random() * Grid.img_width),
      Math.floor(Math.random() * Grid.img_height),
      [255, 255, 255, 255]
    );
  }
  Grid.update(center_point);
  window.requestAnimationFrame(draw);
}

// events
window.addEventListener("DOMContentLoaded", () => {
  window.requestAnimationFrame(draw); // Start drawing
});
// dragging controls
(() => {
  let drag_offset = null;
  window.addEventListener("mousedown", ({ x, y }) => {
    drag_offset = new po.Pixel(x, y);
  });
  window.addEventListener("mousemove", ({ buttons, x, y }) => {
    if (!buttons & 1 || !drag_offset) {
      // primary mouse not pressed
      return;
    }
    center_point.add(x - drag_offset.x, y - drag_offset.y);
    console.log(center_point);
    drag_offset = new po.Pixel(x, y);
  });
})();
