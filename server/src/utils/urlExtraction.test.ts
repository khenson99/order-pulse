import { describe, expect, it } from 'vitest';
import { extractImageUrlsFromHtml } from './urlExtraction.js';

describe('urlExtraction', () => {
  it('does not treat arbitrary text URLs as image candidates', () => {
    const html = `
      <html>
        <body>
          See https://example.com/products/widget-123
          <img src="https://cdn.example.com/assets/widget.jpg" />
        </body>
      </html>
    `;

    const images = extractImageUrlsFromHtml(html);

    expect(images).toContain('https://cdn.example.com/assets/widget.jpg');
    expect(images).not.toContain('https://example.com/products/widget-123');
  });
});

