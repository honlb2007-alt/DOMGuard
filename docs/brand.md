# DOMGuard brand

The mark is a geometric letter D with one brass stroke through it. The stroke is a redaction, the moment something was painted out. The D is a drawn shape, not a font.

## Color

Three flat colors. No other hues.

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#101114` | The icon tile, frames, and ordinary text. |
| Paper | `#E8EAEF` | The letter D, and primary text on ink. |
| Brass | `#E2B15A` | Only the redaction stroke, and the one emphasis on a screen. Not for decoration. |

Paper on ink is about 15.7:1. Brass on ink is about 9.6:1. On Chrome’s dark toolbar (`#202124`) the ink tile is only about 1.2:1, so the tile disappears. The paper letter and the brass stroke have to carry the silhouette on their own: about 13.4:1 and 8.2:1 against that toolbar.

## Measure

The base unit is 8. Spacing, icon coordinates, and corner radii stay on multiples of 8 wherever a size has to land on a whole pixel.

The icon canvas is 128. The corner radius is 24, about 19% of the side rather than a fractional 20%, so the curve is 3px at 16, 6px at 32, and 9px at 48.

On the 128 drawing the letter is 80 units tall, 62.5% of the canvas, and centered. The stroke is 20 units on the stem, the arc, and the top and bottom. The counter is 28 by 40: about 41% of the letter’s width and 50% of its height, with a semicircular end. The brass stroke is 12 units tall, about 15% of the letter, and it starts on the letter’s center line and sits below it so the upper half of the counter stays open. It extends 6 units past the letter on each side. Its ends use a radius of 4.

## Type

Use the system stack already in the popup: `"Segoe UI", system-ui, sans-serif`.

Do not load a font from the network. If a later screen needs a specific face, ship the file inside the extension.

## Icons

`src/icons/icon.svg` is the 128 master. `icon48.png` and `icon128.png` are rasterized from it. The rounded square is left smooth so the corners can curve. The letter is a path with `fill-rule="evenodd"`. The brass stroke is a rounded rectangle, not a font and not a line.

`src/icons/icon-32.svg` and `src/icons/icon-16.svg` are drawn for those sizes. They are not scaled copies of the master. At 32 the stroke is thicker and the counter stays open. At 16 every coordinate is an integer pixel, the counter is at least 3 pixels wide, and the brass stroke is 3 pixels tall.

`src/icons/store-icon-128.png` is the store listing image. The same 128 mark is scaled into a 96 box, centered on a 128 canvas, with transparent padding. It is not part of the extension package.

## Do not

- Gradients, glows, or shadows
- 3D, locks, keys, or a shield as this mark
- Thin lines, or any text or font inside the icon
- A second accent color
- Remote fonts, CDN assets, or tracking pixels
- Scaling the 128 drawing down to 16 or 32
