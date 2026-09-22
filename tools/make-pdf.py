#!/usr/bin/env python3
"""
Builds HUONG-DAN-SU-DUNG.pdf from HUONG-DAN-SU-DUNG.md.

Run it after editing the guide or replacing a screenshot:

    pip install markdown pypdfium2
    npm install -g playwright          # only for the Chromium it ships
    python3 tools/make-pdf.py

Chromium does the rendering because it is the only thing here that handles
Vietnamese text, the screenshots and CSS page breaks in one pass. The cover is
rendered separately: Chromium puts its footer on every page of a document and
applies one margin to all of them, so a full-bleed cover with no page number
cannot live in the same render as the body.
"""

import base64, io, os, re, subprocess, sys, tempfile

import markdown
import pypdfium2 as pdfium

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
SCRATCH = tempfile.mkdtemp(prefix='ckoa-pdf-') + '/'
OUT = REPO + 'HUONG-DAN-SU-DUNG.pdf'

md = io.open(REPO + 'HUONG-DAN-SU-DUNG.md', encoding='utf-8').read()

# The table of contents is for scrolling a web page; in print the pages
# themselves do that job, so drop it and the in-page jump links.
md = re.sub(r'## Mục lục\n.*?\n---\n', '', md, flags=re.S)
md = re.sub(r'\[([^\]]+)\]\(#[^)]+\)', r'\1', md)
# The title becomes the cover page instead.
md = re.sub(r'^# Hướng dẫn sử dụng app đặt hàng\n\n', '', md)

html_body = markdown.markdown(md, extensions=['tables', 'attr_list', 'md_in_html'])

# The markdown sets a pixel width for the web. In print the screenshots float
# beside their text instead, so drop that and classify by shape.
html_body = re.sub(r'\s*width="\d+"', '', html_body)

TALL = ('03-', '04-', '05-', '06-', '07-')  # phone screenshots

def embed(m):
    """Inline every image so the PDF is one self-contained file."""
    path = m.group(1)
    name = os.path.basename(path)
    cls = 'shot tall' if name.startswith(TALL) else 'shot wide'
    data = base64.b64encode(open(REPO + path, 'rb').read()).decode()
    return 'class="%s" src="data:image/png;base64,%s"' % (cls, data)

html_body = re.sub(r'src="([^"]+\.png)"', embed, html_body)

def make_steps(html):
    """
    Each numbered step is short text plus one screenshot. Left to float, the
    screenshots stack into a chain that drags half-empty pages behind it, so
    put every step's text and picture side by side in a block of their own
    that a page break cannot split.
    """
    parts = re.split(r'(<h3>.*?</h3>)', html, flags=re.S)
    out = [parts[0]]
    for head, body in zip(parts[1::2], parts[2::2]):
        img = re.search(r'<img class="shot [^"]*"[^>]*>', body)
        if not img:
            # A short subsection with no picture still has to stay with its
            # heading, or the heading strands at the foot of a page.
            plain = re.sub(r'<[^>]+>', '', body).strip()
            wrap = '<div class="keep">%s%s</div>' if len(plain) < 700 else '%s%s'
            out.append(wrap % (head, body))
            continue
        text = body.replace(img.group(0), '')
        text = re.sub(r'<p>\s*</p>', '', text)
        out.append('%s<div class="step"><div class="step-text">%s</div>%s</div>'
                   % (head, text, img.group(0)))
    return ''.join(out)

html_body = make_steps(html_body)
logo = base64.b64encode(open(REPO + 'assets/logo.png', 'rb').read()).decode()

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; }
@page :first { margin: 0; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", sans-serif; font-size: 10pt; line-height: 1.5;
       color: #222; margin: 0; }

/* Cover */
.cover { position: absolute; inset: 0; display: flex; flex-direction: column;
         justify-content: center; align-items: center; text-align: center;
         padding: 0 28mm; background: #f7f5f2; }
.cover img { width: 78mm; margin-bottom: 14mm; }
.cover h1 { font-size: 30pt; margin: 0 0 6mm; color: #9c2c20; line-height: 1.2; }
.cover .sub { font-size: 13pt; color: #555; margin-bottom: 16mm; line-height: 1.6; }
.cover .meta { font-size: 9.5pt; color: #888; }

h2 { font-size: 15.5pt; color: #9c2c20; margin: 0 0 5mm; padding-bottom: 2mm;
     border-bottom: 2px solid #c0392b; break-after: avoid; margin-top: 9mm; }
h2:first-of-type { margin-top: 0; }
h3 { font-size: 12pt; color: #222; margin: 6mm 0 2.5mm; break-after: avoid; }
p { margin: 0 0 3mm; }
strong { color: #111; }

/* Every list here is short. Keeping each whole stops a heading from sitting
   alone at the foot of a page with its bullets stranded overleaf. */
ul, ol { margin: 0 0 3mm; padding-left: 6mm; break-inside: avoid; }
li { margin-bottom: 1.6mm; }

a { color: #9c2c20; text-decoration: none; }

code { font-family: "DejaVu Sans Mono", monospace; font-size: 9.5pt;
       background: #f0ece7; padding: 0.4mm 1.4mm; border-radius: 2px; }

blockquote { margin: 4mm 0; padding: 3mm 4mm; background: #fdf6f4;
             border-left: 3px solid #c0392b; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }

table { border-collapse: collapse; width: 100%; margin: 4mm 0; font-size: 9pt; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
th { background: #9c2c20; color: #fff; text-align: left; font-weight: bold; }
th, td { border: 1px solid #ddd8d2; padding: 2mm 2.6mm; vertical-align: top; }
tr:nth-child(even) td { background: #faf8f6; }

hr { display: none; }

/* Screenshots float beside their text: stacking them full-width leaves half
   the page empty and pushes the guide to twice the length. */
img.shot { float: right; clear: right; margin: 1mm 0 4mm 7mm;
           border: 1px solid #e0dbd4; border-radius: 3px; break-inside: avoid; }
img.tall { width: 48mm; }
img.wide { width: 70mm; }

.keep { break-inside: avoid; }

/* A step: text on the left, its screenshot on the right, kept together. */
.step { display: flex; align-items: flex-start; gap: 7mm; margin-bottom: 6mm;
        break-inside: avoid; }
.step-text { flex: 1 1 auto; min-width: 0; }
.step-text > :last-child { margin-bottom: 0; }
.step img.shot { float: none; margin: 0; flex: 0 0 auto; }
h2, h3 { clear: both; }
h2 + p, h3 + p { margin-top: 0; }
"""

SHELL = ('<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">'
         '<title>Hướng dẫn sử dụng app đặt hàng</title>'
         '<style>%s</style></head><body>%s</body></html>')

cover = """<div class="cover">
  <img src="data:image/png;base64,%s" alt="">
  <h1>Hướng dẫn sử dụng<br>app đặt hàng</h1>
  <div class="sub">Dành cho nhân viên nhà hàng<br>và bếp trung tâm</div>
  <div class="meta">Central Kitchen Ordering App &middot; Saigon Express</div>
</div>""" % logo

io.open(SCRATCH + 'cover.html', 'w', encoding='utf-8').write(SHELL % (CSS, cover))
io.open(SCRATCH + 'body.html', 'w', encoding='utf-8').write(SHELL % (CSS, html_body))

render = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'render.js')
subprocess.run(['node', render, SCRATCH + 'cover.html', SCRATCH + 'cover.pdf', 'bare'], check=True)
subprocess.run(['node', render, SCRATCH + 'body.html', SCRATCH + 'body.pdf'], check=True)

merged = pdfium.PdfDocument.new()
for part in ('cover.pdf', 'body.pdf'):
    merged.import_pages(pdfium.PdfDocument(SCRATCH + part))
merged.save(OUT)

print('%s - %d pages, %.0f KB' % (OUT, len(pdfium.PdfDocument(OUT)), os.path.getsize(OUT) / 1024))
