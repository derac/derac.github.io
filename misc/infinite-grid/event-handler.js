import * as grid from "./InfiniteGrid.js";

const canvas = document.getElementById("canvas");
const SCALE = 1;
const ACCELERATION = 1.02;
let WIDTH = window.innerWidth / SCALE;
let HEIGHT = window.innerHeight / SCALE;
let Grid = new grid.InfiniteGrid(canvas, WIDTH, HEIGHT);
let center_offset = new grid.Pixel(
  -Grid.img_width / 2 + WIDTH / 2,
  -Grid.img_height / 2 + HEIGHT / 2
);
let current_xy = null;
let offset_xy = null;
let movespeed = 1;
let is_mousedown = false;

function draw() {
  for (let _ of [...Array(100).keys()]) {
    Grid.set_pixel(
      Math.floor(Math.random() * Grid.img_width),
      Math.floor(Math.random() * Grid.img_height),
      [255, 255, 255, Math.floor(Math.random() * 255)]
    );
  }
  if (!is_mousedown) {
    movespeed /= ACCELERATION;
  }
  if (offset_xy) {
    center_offset.add(offset_xy.x * movespeed, offset_xy.y * movespeed);
  }
  Grid.update(center_offset);
  window.requestAnimationFrame(draw);
}

// start draw loop
window.addEventListener("DOMContentLoaded", () => {
  window.requestAnimationFrame(draw);
});
// dragging
(() => {
  window.addEventListener("mousedown", ({ x, y }) => {
    is_mousedown = true;
    movespeed = 1;
    current_xy = new grid.Pixel(x, y);
  });
  window.addEventListener("mouseup", () => {
    is_mousedown = false;
  });
  window.addEventListener("mousemove", ({ buttons, x, y }) => {
    if (!buttons & 1) {
      return;
    }
    offset_xy = new grid.Pixel(x - current_xy.x, y - current_xy.y);
    movespeed *=
      ACCELERATION **
      (1 + Math.floor(Math.sqrt(offset_xy.x ** 2, offset_xy.y ** 2) / 10)); // increasing accelleration using the distance dragged not just by frame
    current_xy = new grid.Pixel(x, y);
  });
  window.addEventListener("touchstart", ({ changedTouches }) => {
    let x = changedTouches[0].screenX;
    let y = changedTouches[0].screenY;
    current_xy = new grid.Pixel(x, y);
  });
  window.addEventListener("touchmove", ({ changedTouches }) => {
    let x = changedTouches[0].screenX;
    let y = changedTouches[0].screenY;
    offset_xy = new grid.Pixel(x - current_xy.x, y - current_xy.y);
    current_xy = new grid.Pixel(x, y);
    center_offset.add(offset_xy.x, offset_xy.y);
  });
})();
// zooming
(() => {
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key in ["+", "-"]) {
      event.preventDefault();
    }
  });
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey == true) {
        event.preventDefault();
      }
      Grid.zoom(-Math.sign(event.deltaY));
    },
    { passive: false }
  );
})();
