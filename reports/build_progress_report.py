"""Build the MachineMD progress report as DOCX + HTML (HTML is printed to PDF by e2e/html-to-pdf.mjs).

Layout follows the team's progress-report template: centred title with the date, then
Product Designed / Platform Used / AI Model Used, Product Details, Deliverables, links and BUGS,
with before/after screenshots next to each bug.  No third-party Python packages are needed.

Run:  python3 reports/build_progress_report.py
"""
from __future__ import annotations

import html
import struct
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
DATE = '25-11-2026'
STEM = f'MachineMD_Progress_Report_{DATE}'
WEBSITE = 'https://machinemd.vercel.app'
REPOSITORY = 'https://github.com/DIVYAPRIYADHARSHINI-GIT/machinemd'
AI_MODEL = '[confirm model name]'  # the model identifier is not exposed in this session

B = lambda t: (t, True)   # bold run
N = lambda t: (t, False)  # normal run

blocks: list[tuple] = []
add = blocks.append

add(('title', f'PROGRESS REPORT {DATE}'))
add(('field_block', [('Product Designed:', None), (None, 'MachineMD - Predictive Maintenance App')]))
add(('field', 'Platform Used: ', 'Designer v0.0.37'))
add(('field', 'AI Model Used: ', AI_MODEL))
add(('label', 'Product Details:'))
add(('para', [B('MachineMD'), N(' is a predictive-maintenance web app for pumps, motors, compressors and AC units. It reads six sensors '
    '(temperature, vibration, pressure, RPM, running hours and current draw) and for every machine shows the chance of failure in the '
    'next 7 days, a 0-100 health score, a Low / Medium / High risk level, the remaining useful life in days, an anomaly flag and the '
    'sensors that drive the risk.')]))
add(('para', [N('Admins upload sensor data, retrain and switch models, manage machines and users, and keep the maintenance log. Viewers '
    'can see everything but change nothing. It runs as one Vercel project: a React website plus a Python (FastAPI) backend with a '
    'real machine-learning pipeline built in.')]))
add(('para', [B('MachineMD does not use AI at runtime.'), N(' AI helped build the app, but the predictions come from scikit-learn models '
    'trained on the app\'s own data. The same sensor readings always give the same result.')]))
add(('numbered', [
    [B('Generate the data.'), N(' A built-in generator creates 30 machines with 90 days of readings every 6 hours (10,696 readings, 26 failures). '
        'Before each failure, temperature and vibration climb, with realistic noise. About 7.4 % of readings fall in the week before a failure.')],
    [B('Build the features.'), N(' For each sensor the model sees the current value plus the average, spread and trend of the last 7 readings: 24 features in total.')],
    [B('Train and compare.'), N(' Random Forest and Gradient Boosting are trained on the earlier weeks and tested on the later weeks, with a 7-day gap so nothing leaks. '
        'Random Forest is used for predictions: '), B('F1 0.785, ROC-AUC 0.921'), N(', and only 5 false alarms in 2,169 healthy readings.')],
    [B('Turn risk into action.'), N(' Health score = 100 x (1 - failure probability). A second model estimates remaining life (average error '), B('1.34 days'),
        N('), an Isolation Forest flags unusual patterns, and a what-if test shows which sensor moves the risk most. High-risk machines raise alerts, which close when maintenance is logged.')],
]))
add(('para', [N('So it '), B('gives tested predictions with an explanation for every machine'), N(', rather than made-up numbers.')]))
add(('label_inline', 'Deliverables: ', [
    '1. A working full-stack web app (12 pages, admin and viewer roles), live on Vercel.',
    '2. ML pipeline: data generator, two compared failure models, remaining-life model, anomaly detection, what-if explanations, model registry and in-app retraining.',
    '3. Public GitHub repository with README, automated tests, the seeded database and the trained models.',
    '4. Final report, bug log and this progress report with screenshots.',
]))
add(('link', 'Website Link: ', WEBSITE))
add(('link', 'GitHub Link: ', REPOSITORY))
add(('label', 'BUGS:'))
add(('para', [N('8 bugs found and fixed, 0 open. Final result on the live site: '), B('65/65'), N(' acceptance checks and '), B('15/15'),
    N(' flow checks pass. Each bug shows the screenshot taken when it happened and the screenshot after the fix.')]))

BUGS = [
    ('BUG-01 (Medium): Page scrolled sideways on mobile',
     'On a phone (390 px) the Dashboard was 407 px wide, so the chart and alert cards stuck out past the edge.',
     'Let every grid card shrink to the screen width. No page scrolls sideways now, in light or dark mode.',
     'screenshots/BUG-01-dashboard-mobile-horizontal-overflow.png', 'Before: cards stick out (17 px overflow)',
     'screenshots/BUG-01-fixed.png', 'After: everything fits the screen'),
    ('BUG-02 (High): Machine search dropped typed letters',
     'Typing "compressor" quickly left only "or" in the search box, and the table showed 17 wrong machines.',
     'The search box keeps its own text and updates the address after a short pause. It now shows "compressor" and exactly 7 machines.',
     'screenshots/BUG-02-machines-search-drops-typed-characters.png', 'Before: "or", 17 machines',
     'screenshots/BUG-02-fixed.png', 'After: "compressor", 7 machines'),
    ('BUG-03 (High): Form dialogs lost focus and closed while typing',
     'After the first letter the cursor jumped to the close button; pressing space closed the dialog and the text was lost.',
     'The dialog now sets focus only once, on the first form field. Typing works in every dialog in the app.',
     'screenshots/BUG-03-maintenance-form-loses-focus-while-typing.png', 'Before: dialog closed, text lost',
     'screenshots/BUG-03-fixed.png', 'After: "Bearing noise" stays in the field'),
    ('BUG-04 (Low): Message covered buttons on the last table rows',
     'After adding a machine, the success message sat on top of the new row\'s Edit button, so clicking Edit did nothing.',
     'Added space at the bottom of every page so the last rows scroll clear of messages. Edit opens the form.',
     'screenshots/BUG-04-toast-covers-last-row-actions.png', 'Before: message over the action buttons',
     'screenshots/BUG-04-fixed.png', 'After: Edit opens the form'),
    ('BUG-05 (Low): After sign-out, next sign-in opened the previous user\'s page',
     'A user signed out from Settings and the next person to sign in landed on Settings instead of the Dashboard.',
     'The last page is remembered only when a session expires, not after a deliberate sign-out.',
     'screenshots/BUG-05-signin-after-logout-returns-to-previous-page.png', 'Before: fresh sign-in opened Settings',
     'screenshots/BUG-05-fixed.png', 'After: fresh sign-in opens the Dashboard'),
    ('BUG-06 (High): What-if simulator disagreed with the real prediction',
     'For ACU-007 (really 61 %, High risk) the simulator showed 14 %, Low before any slider moved; 8 of 30 machines differed.',
     'The simulator now uses the machine\'s real recent history. All 30 machines match, and an automatic test guards it.',
     'screenshots/BUG-06-whatif-disagrees-with-live-prediction.png', 'Before: 61 % High shown as 14 % Low',
     'screenshots/BUG-06-fixed.png', 'After: 61 % High, matching the real prediction'),
    ('BUG-07 (High, live site only): Data changed from one page load to the next',
     'Vercel runs several server copies, each with its own temporary database. After a retrain only 8 of 12 requests saw the new model.',
     'Each admin change now comes back to the browser with a tamper-proof signature, and any server copy applies the changes it missed. 12 of 12 requests now agree.',
     'screenshots/BUG-07-live-state-differs-between-vercel-instances.png', 'Before: 8 of 12 requests see the new model',
     'screenshots/BUG-07-fixed.png', 'After: 12 of 12 requests see it'),
    ('BUG-08 (Medium, live site only): Sign-out did not log out everywhere',
     'After signing out, the old login still worked on 7 of 12 requests (same cause as BUG-07).',
     'Sign-out now travels in the same signed change list. 0 of 12 requests accept the old login.',
     'screenshots/BUG-08-live-logout-token-still-valid-on-other-instances.png', 'Before: 7 of 12 still accepted',
     'screenshots/BUG-08-fixed.png', 'After: 0 of 12 accepted'),
]
for title, problem, fix, b_img, b_cap, a_img, a_cap in BUGS:
    add(('bug_title', title))
    add(('para', [B('Problem: '), N(problem)]))
    add(('para', [B('Fix: '), N(fix)]))
    add(('pair', b_img, b_cap, a_img, a_cap))

add(('bug_title', 'Deployment issue (fixed before go-live): Vercel size limit'))
add(('para', [B('Problem: '), N('The Python bundle was 246 MB, over Vercel\'s 225 MB limit, because the newest numpy / scipy / scikit-learn get bundled in full.')]))
add(('para', [B('Fix: '), N('Pinned numpy 2.2.6, scipy 1.16.3 and scikit-learn 1.7.2, which Vercel installs at start-up; retrained and re-tested. The build completes and the site is live.')]))

add(('label', 'Features Improved:'))
add(('numbered', [
    [B('What-if simulator matches the real prediction'), N(' when started from a machine, then shows how each sensor change moves the risk.')],
    [B('Consistent data on the live site'), N(' across all of Vercel\'s server copies: retrain, upload, maintenance, alerts, settings, reset and sign-out.')],
    [B('Steady typing'), N(' in the machine search and every pop-up form.')],
    [B('Mobile layout'), N(' fits every page at phone width, in light and dark mode.')],
    [B('Safer sign-in and sign-out'), N(': sign-out ends the session everywhere, and the next person starts on the Dashboard.')],
    [B('Time zones handled'), N(': uploaded times such as 12:00 +05:30 are saved correctly as 06:30 UTC.')],
    [B('Honest model results'), N(': calibrated probabilities and a "do-nothing" baseline row in the Model Lab.')],
    [B('"Waking up the server" message'), N(' on slow first sign-ins instead of a frozen-looking page.')],
]))
add(('image', 'screenshots/live/LIVE-07-what-if-machine.png', 'Live: what-if simulator starts at the machine\'s real 100 % High risk and shows vibration and temperature as the main drivers'))
add(('image', 'screenshots/live/LIVE-06-model-lab.png', 'Live: Model Lab with model comparison, baseline row, confusion matrices, feature importance and ROC / PR curves'))
add(('pair', 'screenshots/live/LIVE-16-mobile-dashboard.png', 'Live: mobile dashboard',
     'screenshots/live/LIVE-01b-login-waking-up.png', 'Live: "Waking up the server, please wait..."'))

# ------------------------------------------------------------------ DOCX writer
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
images: list[tuple[str, str, bytes]] = []
links: list[tuple[str, str]] = []
EMU = 914400


def r(text, bold=False, size=None, color=None):
    props = ('<w:b/>' if bold else '') + (f'<w:color w:val="{color}"/>' if color else '') + (f'<w:sz w:val="{size}"/>' if size else '')
    return '<w:r>' + (f'<w:rPr>{props}</w:rPr>' if props else '') + f'<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def p(runs, jc=None, after=None, before=None, keep=False, ind=None, hanging=None):
    pr = ''
    if keep:
        pr += '<w:keepNext/>'
    if before is not None or after is not None:
        attrs = (' w:before="%s"' % before if before is not None else '') + (' w:after="%s"' % after if after is not None else '')
        pr += '<w:spacing' + attrs + '/>'
    if ind is not None:
        pr += f'<w:ind w:left="{ind}"' + (f' w:hanging="{hanging}"' if hanging else '') + '/>'
    if jc:
        pr += f'<w:jc w:val="{jc}"/>'
    return '<w:p>' + (f'<w:pPr>{pr}</w:pPr>' if pr else '') + ''.join(runs) + '</w:p>'


def img_run(rel_path, max_w_in, max_h_in):
    data = (HERE / rel_path).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', rel_path
    w, h = struct.unpack('>II', data[16:24])
    scale = min(max_w_in / w, max_h_in / h)
    cx, cy = int(w * scale * EMU), int(h * scale * EMU)
    n = len(images) + 1
    rid = f'rIdImg{n}'
    name = f'image{n}.png'
    images.append((rid, name, data))
    return (f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
            f'<wp:docPr id="{n}" name="Picture {n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
            f'<pic:nvPicPr><pic:cNvPr id="{n}" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')


def cell(content, width):
    return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{content}</w:tc>')


body: list[str] = []
for blk in blocks:
    kind = blk[0]
    if kind == 'title':
        body.append(p([r(blk[1], bold=True, size=26)], jc='center', before=600, after=480))
    elif kind == 'field_block':
        body.append(p([r('Product Designed:', bold=True)], after=0))
        body.append(p([r(blk[1][1][1])], after=0))
    elif kind == 'field':
        body.append(p([r(blk[1], bold=True), r(blk[2])], after=0))
    elif kind == 'label':
        body.append(p([r(blk[1], bold=True)], before=280, after=160, keep=True))
    elif kind == 'para':
        body.append(p([r(t, bold=b) for t, b in blk[1]], after=200))
    elif kind == 'numbered':
        for i, runs in enumerate(blk[1], 1):
            body.append(p([r(f'{i}.\t')] + [r(t, bold=b) for t, b in runs], after=60, ind=720, hanging=360))
        body.append(p([], after=60))
    elif kind == 'label_inline':
        items = blk[2]
        body.append(p([r(blk[1], bold=True), r(items[0])], before=200, after=0, ind=1300, hanging=1300))
        for it in items[1:]:
            body.append(p([r(it)], after=0, ind=1300))
        body.append(p([], after=60))
    elif kind == 'link':
        rid = f'rIdLink{len(links) + 1}'
        links.append((rid, blk[2]))
        body.append(p([r(blk[1], bold=True),
                       f'<w:hyperlink r:id="{rid}"><w:r><w:rPr><w:color w:val="1155CC"/><w:u w:val="single"/></w:rPr><w:t>{escape(blk[2])}</w:t></w:r></w:hyperlink>'],
                      after=40))
    elif kind == 'bug_title':
        body.append(p([r(blk[1], bold=True)], before=320, after=100, keep=True))
    elif kind == 'pair':
        _, i1, c1, i2, c2 = blk
        cap = lambda t: p([r(t, size=17, color='555555')], jc='center', after=0)
        c_left = p([img_run(i1, 3.05, 3.6)], jc='center', after=40) + cap(c1)
        c_right = p([img_run(i2, 3.05, 3.6)], jc='center', after=40) + cap(c2)
        body.append('<w:tbl><w:tblPr><w:tblW w:w="9800" w:type="dxa"/><w:jc w:val="center"/>'
                    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
                    '<w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>'
                    '<w:tblGrid><w:gridCol w:w="4900"/><w:gridCol w:w="4900"/></w:tblGrid>'
                    f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{cell(c_left, 4900)}{cell(c_right, 4900)}</w:tr></w:tbl>')
        body.append(p([], after=60))
    elif kind == 'image':
        body.append(p([img_run(blk[1], 6.3, 4.6)], jc='center', after=40, before=160))
        body.append(p([r(blk[2], size=17, color='555555')], jc='center', after=160))

body.append('<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1200" w:right="1250" w:bottom="1100" w:left="1250" w:header="500" w:footer="500"/></w:sectPr>')
NS = (f'xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{"".join(body)}</w:body></w:document>'
styles = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:color w:val="111111"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'''
footer = (f'<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="{W}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>'
          '<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t xml:space="preserve">MachineMD | Progress Report | Page </w:t></w:r>'
          '<w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>')
RELNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
rels = (f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{RELNS}">'
        f'<Relationship Id="rIdStyles" Type="{R}/styles" Target="styles.xml"/>'
        f'<Relationship Id="rIdFooter" Type="{R}/footer" Target="footer1.xml"/>'
        + ''.join(f'<Relationship Id="{rid}" Type="{R}/hyperlink" Target="{escape(url)}" TargetMode="External"/>' for rid, url in links)
        + ''.join(f'<Relationship Id="{rid}" Type="{R}/image" Target="media/{name}"/>' for rid, name, _ in images)
        + '</Relationships>')
rootrels = (f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{RELNS}">'
            f'<Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')
ct = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      '<Default Extension="png" ContentType="image/png"/>'
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
core = ('<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>MachineMD Progress Report ' + DATE + '</dc:title><dc:creator>Divya Priyadharshini</dc:creator></cp:coreProperties>')
parts = {'[Content_Types].xml': ct, '_rels/.rels': rootrels, 'docProps/core.xml': core, 'word/document.xml': document,
         'word/styles.xml': styles, 'word/footer1.xml': footer, 'word/_rels/document.xml.rels': rels}
for xml in parts.values():
    ET.fromstring(xml)  # every part must be well-formed XML
docx = HERE / f'{STEM}.docx'
with ZipFile(docx, 'w', ZIP_DEFLATED) as z:
    for name, xml in parts.items():
        z.writestr(name, xml.encode('utf-8'))
    for _, name, data in images:
        z.writestr('word/media/' + name, data)
with ZipFile(docx) as z:
    assert z.testzip() is None

# ------------------------------------------------------------------ HTML twin (for the PDF)
def runs_html(runs):
    return ''.join(f'<b>{html.escape(t)}</b>' if b else html.escape(t) for t, b in runs)


out = []
for blk in blocks:
    kind = blk[0]
    if kind == 'title':
        out.append(f'<h1>{html.escape(blk[1])}</h1>')
    elif kind == 'field_block':
        out.append(f'<p class="tight"><b>Product Designed:</b><br>{html.escape(blk[1][1][1])}</p>')
    elif kind == 'field':
        out.append(f'<p class="tight"><b>{html.escape(blk[1])}</b>{html.escape(blk[2])}</p>')
    elif kind == 'label':
        out.append(f'<p class="label"><b>{html.escape(blk[1])}</b></p>')
    elif kind == 'para':
        out.append(f'<p>{runs_html(blk[1])}</p>')
    elif kind == 'numbered':
        out.append('<ol>' + ''.join(f'<li>{runs_html(x)}</li>' for x in blk[1]) + '</ol>')
    elif kind == 'label_inline':
        out.append('<table class="deliv"><tr><td><b>' + html.escape(blk[1].strip()) + '</b></td><td>'
                   + '<br>'.join(html.escape(x) for x in blk[2]) + '</td></tr></table>')
    elif kind == 'link':
        out.append(f'<p class="tight"><b>{html.escape(blk[1])}</b><a href="{blk[2]}">{html.escape(blk[2])}</a></p>')
    elif kind == 'bug_title':
        out.append(f'<p class="bug"><b>{html.escape(blk[1])}</b></p>')
    elif kind == 'pair':
        _, i1, c1, i2, c2 = blk
        out.append(f'<div class="pair"><figure><img src="{i1}"><figcaption>{html.escape(c1)}</figcaption></figure>'
                   f'<figure><img src="{i2}"><figcaption>{html.escape(c2)}</figcaption></figure></div>')
    elif kind == 'image':
        out.append(f'<figure class="single"><img src="{blk[1]}"><figcaption>{html.escape(blk[2])}</figcaption></figure>')
css = '''
body{font:10.5pt/1.5 Arial,Helvetica,sans-serif;color:#111;margin:0}
h1{font-size:13pt;text-align:center;margin:22pt 0 22pt}
p{margin:0 0 9pt} p.tight{margin:0 0 2pt} p.label{margin:14pt 0 7pt;break-after:avoid}
p.bug{margin:16pt 0 5pt;break-after:avoid}
ol{margin:0 0 9pt;padding-left:30pt} li{margin:0 0 3pt}
table.deliv{border-collapse:collapse;margin:10pt 0 8pt} table.deliv td{vertical-align:top;padding:0 6pt 0 0}
a{color:#1155cc}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8pt;break-inside:avoid;margin:4pt 0 6pt}
figure{margin:0;break-inside:avoid} figure img{width:100%;border:1px solid #ccc}
.pair img{max-height:250pt;object-fit:contain;object-position:top;background:#f7f7f7}
.single{margin:10pt 0} .single img{max-height:330pt;object-fit:contain}
figcaption{font-size:8pt;color:#555;text-align:center;margin-top:2pt}
'''
(HERE / f'{STEM}.html').write_text(f'<!doctype html><html><head><meta charset="utf-8"><title>MachineMD Progress Report {DATE}</title>'
                                   f'<style>{css}</style></head><body>{"".join(out)}</body></html>')

text = ''.join(ET.fromstring(document).itertext())
for required in ['PROGRESS REPORT', 'Product Designed:', 'Platform Used:', 'AI Model Used:', 'Product Details:', 'Deliverables:', 'BUGS:',
                 'Website Link:', 'GitHub Link:', WEBSITE, REPOSITORY, 'BUG-08', 'Features Improved:']:
    assert required in text, required
print(f'DOCX: {docx} ({docx.stat().st_size:,} bytes, {len(images)} images, {len(links)} links)')
print(f'HTML: {HERE / (STEM + ".html")}')
