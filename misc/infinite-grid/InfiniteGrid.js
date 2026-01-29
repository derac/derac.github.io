function* enumerate(array) {
  for (let i = 0; i < array.length; i += 1) {
    yield [i, array[i]];
  }
}

export class Pixel {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  add(x, y) {
    this.x += x;
    this.y += y;
  }
}

export class InfiniteGrid {
  constructor(canvas, width, height) {
    this.zoom_factor = 0;
    this.context = canvas.getContext("2d");
    this.width = width;
    this.height = height;
    this.img_width = width * 4; // this is for setting an image bigger than the canvas
    this.img_height = height * 4;
    this.context.canvas.width = width;
    this.context.canvas.height = height;
    this.img = this.context.createImageData(this.img_width, this.img_height);
  }

  set_pixel(x, y, color) {
    for (let c of enumerate(color)) {
      this.img.data[y * this.img_width * 4 + x * 4 + c[0]] = c[1];
    }
  }

  get_pixel(x, y) {
    return this.img.data[y * this.img_width * 4 + x * 4];
  }

  zoom(amount) {
    this.zoom_factor += amount;
    if (this.zoom_factor < 1) {
      this.zoom_factor = 1;
    }
  }

  update(center_offset) {
    this.context.clearRect(0, 0, this.width, this.height);
    let x_offset = center_offset.x % this.img_width;
    let y_offset = center_offset.y % this.img_height;
    this.context.putImageData(this.img, x_offset, y_offset);
    this.context.putImageData(
      this.img,
      x_offset + (x_offset < 0 ? 1 : -1) * this.img_width,
      y_offset
    );
    this.context.putImageData(
      this.img,
      x_offset,
      y_offset + (y_offset < 0 ? 1 : -1) * this.img_height
    );
    this.context.putImageData(
      this.img,
      x_offset + (x_offset < 0 ? 1 : -1) * this.img_width,
      y_offset + (y_offset < 0 ? 1 : -1) * this.img_height
    );
  }
}
