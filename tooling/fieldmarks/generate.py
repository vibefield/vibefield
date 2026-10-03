"""AFTER HOURS — original VibeField sticker artwork, edition 02.
The primary logo is retained. Every other drawing is new geometry.
"""
from pathlib import Path
import math, json, html, xml.etree.ElementTree as ET
import argparse, io, subprocess, sys, zipfile
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check',action='store_true')
options=parser.parse_args()
EMITTED={}
MISMATCHES=[]
INK='currentColor'
PAPER='var(--vf-sticker-paper, var(--vf-canvas-bg, #fff))'
icons=[]
def node(tag,**attrs): return {'tag':tag,'attrs':attrs}
def p(d,**a): return node('path',d=d,**a)
def s(d,w=3,**a): return p(d,**{'fill':'none','stroke':INK,'strokeWidth':w,'strokeLinecap':'round','strokeLinejoin':'round',**a})
def body(d,w=3,**a): return p(d,fill=PAPER,stroke=INK,strokeWidth=w,strokeLinecap='round',strokeLinejoin='round',**a)
def c(x,y,r,**a): return node('circle',cx=x,cy=y,r=r,**a)
def e(x,y,rx,ry,**a): return node('ellipse',cx=x,cy=y,rx=rx,ry=ry,**a)
def r(x,y,w,h,rx=0,**a): return node('rect',x=x,y=y,width=w,height=h,rx=rx,**a)
def box(x,y,w,h,rx=1,sw=3): return r(x,y,w,h,rx,fill=PAPER,stroke=INK,strokeWidth=sw)
def linecircle(x,y,r,sw=3): return c(x,y,r,fill=PAPER,stroke=INK,strokeWidth=sw)
def oval(x,y,rx,ry,sw=3): return e(x,y,rx,ry,fill=PAPER,stroke=INK,strokeWidth=sw)
def move(nodes,x=0,y=0,scale=1,angle=0):
    return [dict(tag=n['tag'],attrs={**n['attrs'],'transform':f'translate({x} {y}) scale({scale}) rotate({angle} 48 48) '+n['attrs'].get('transform','')}) for n in nodes]
def eye(x,y,rx=8,ry=11,look=2):
    return [oval(x,y,rx,ry,2.4), e(x+look,y+2,rx*.42,ry*.62), c(x+look+1,y-1,1.3,fill=PAPER)]
def star(x,y,sz=6): return p(f'M{x} {y-sz}L{x+sz*.25} {y-sz*.2}L{x+sz} {y}L{x+sz*.25} {y+sz*.2}L{x} {y+sz}L{x-sz*.25} {y+sz*.2}L{x-sz} {y}L{x-sz*.25} {y-sz*.2}Z')
def burst(x,y,outer=35,inner=29,n=16):
    pts=[(x+math.cos(i*math.pi/n)*(outer if i%2==0 else inner),y+math.sin(i*math.pi/n)*(outer if i%2==0 else inner)) for i in range(n*2)]
    return 'M'+'L'.join(f'{a:.2f} {b:.2f}' for a,b in pts)+'Z'
def hatch(x,y,n=5,dx=3,length=8): return [s(f'M{x+i*dx} {y}l{-length*.4} {length}',1.2) for i in range(n)]
def checkers(x,y,cols,rows,unit=3): return [r(x+i*unit,y+j*unit,unit,unit) for j in range(rows) for i in range(cols) if (i+j)%2==0]
LETTERS={
'A':['01110','11011','11011','11111','11011','11011','11011'],
'B':['11110','11011','11011','11110','11011','11011','11110'],
'C':['01111','11000','11000','11000','11000','11000','01111'],
'D':['11110','11011','11011','11011','11011','11011','11110'],
'E':['11111','11000','11000','11110','11000','11000','11111'],
'F':['11111','11000','11000','11110','11000','11000','11000'],
'G':['01111','11000','11000','11011','11011','11011','01111'],
'H':['11011','11011','11011','11111','11011','11011','11011'],
'I':['111','010','010','010','010','010','111'],
'K':['11011','11011','11110','11100','11110','11011','11011'],
'L':['11000','11000','11000','11000','11000','11000','11111'],
'M':['11011','11111','11111','11011','11011','11011','11011'],
'N':['11001','11101','11101','11111','11011','11011','11001'],
'O':['01110','11011','11011','11011','11011','11011','01110'],
'P':['11110','11011','11011','11110','11000','11000','11000'],
'R':['11110','11011','11011','11110','11110','11011','11011'],
'S':['01111','11000','11000','01110','00011','00011','11110'],
'T':['11111','00100','00100','00100','00100','00100','00100'],
'U':['11011','11011','11011','11011','11011','11011','01110'],
'V':['11011','11011','11011','11011','11011','01010','00100'],
'W':['11011','11011','11011','11011','11111','11111','01010'],
'Y':['11011','11011','01010','00100','00100','00100','00100'],
'0':['01110','11011','11011','11011','11011','11011','01110'],
'1':['010','110','010','010','010','010','111'],
'2':['11110','00011','00011','01110','11000','11000','11111'],
'?':['11110','00011','00110','01100','01000','00000','01000'],
'!':['11','11','11','11','11','00','11'],
'>':['100','010','001','010','100','000','000'],
' ':['000']*7,
}
def word(text,x,y,unit=1,fill=INK):
    paths=[]
    for char in text:
        glyph=LETTERS[char]
        for j,row in enumerate(glyph):
            for i,v in enumerate(row):
                if v=='1': paths.append(f'M{x+i*unit:g} {y+j*unit:g}h{unit:g}v{unit:g}h{-unit:g}Z')
        x+=(len(glyph[0])+1)*unit
    return p(''.join(paths),fill=fill)
def icon(name,label,family,nodes,purpose,idea,*,grid=96,minimum=None):
    if minimum is None: minimum=48 if family in ('Brand','Identity','Agents') else 32 if family=='Workspace' else 24
    icons.append(dict(name=name,label=label,family=family,grid=grid,mode='solid',minimum=minimum,purpose=purpose,idea=idea,shapes=nodes))

# Motifs are reused like a print shop's blocks, while each composition has its own silhouette.
def crt():
    return [p('M18 15L70 10L85 20L80 64L28 72L11 59Z'),body('M18 15L70 10L65 57L11 63Z'),s('M70 10L85 20L80 64L65 57',2),p('M24 23L59 20L56 49L21 53Z'),s('M29 29L39 34L28 40',3,stroke=PAPER),s('M42 41L51 40',2,stroke=PAPER),c(18,57,2),*hatch(72,27,3,3,19),p('M33 70L52 67L55 77L69 81L21 86L21 82L36 77Z')]

ns='{http://www.w3.org/2000/svg}'
tray=ET.fromstring((ROOT/'apps/desktop/packaging/icons/tray-master.svg').read_text())
icon('brand-mark','The original loop','Brand',[p(n.attrib['d']) for n in tray.find(ns+'g').findall(ns+'path')],
     'The unchanged VibeField master, anchoring the new sticker collection.','Retained exactly. The new sticker artwork surrounds the identity; the master itself is not distressed.',grid=480,minimum=32)
icon('brand-field','Field trip','Brand',[
    *move(crt(),4,-3,.9,-7),
    body('M13 77Q38 81 78 70L83 73Q84 79 72 82L25 88Q11 89 10 82Z',2.5),
    c(26,88,4),c(70,82,4),s('M7 61L16 60M3 68L13 67M7 74L18 72',2.2),star(84,12,6),star(7,31,4),
    *checkers(30,75,8,2,2.5)
], 'VibeField’s editorial mascot: a terminal taking the field with it.',
'A squat CRT rides a checkerboard deck. The asymmetrical perspective, fat underside, vent cuts, and little wheels give programmable work a physical life.')
icon('brand-held-card','Handle with feeling','Brand',[
    body('M17 29L57 18L73 53L31 69Z'),p('M21 32L55 23L61 36L27 46Z'),
    body('M39 44Q44 33 55 34Q67 35 69 43Q60 53 49 53Z',2.3),c(54,43,5),c(56,41,1.5,fill=PAPER),
    body('M26 68Q16 69 12 57L8 43Q7 39 11 38Q14 38 17 47L21 51L19 32Q19 26 23 27L28 48L33 30Q36 25 39 29L36 52L43 42Q46 39 49 43L42 60Q39 64 39 71L30 77Z'),
    body('M23 72L40 67L46 80L28 87Z'),*hatch(30,76,3,3,7),s('M23 54Q34 52 34 61',2),star(80,25,8),s('M75 65L84 70M78 55L89 55',2.5)
], 'A brand sticker for the living-card promise.',
'A glove reaches around a card that looks back at its owner. Overlapping contours and a striped cuff replace the first edition’s abstract card-and-hand shorthand.')
icon('brand-swarm','The night crew','Brand',[
    p('M7 83L13 67L24 65L35 50L47 58L60 48L76 58L90 82Z'),
    body('M8 52Q9 28 24 26Q39 27 39 52L35 72L29 66L24 74L19 67L12 72Z'),*eye(21,44,5,8,1),*eye(32,44,4,7,-1),
    body('M40 35L65 32L72 66L44 69Z'),p('M44 38L63 36L65 45L45 48Z'),word('VF',48,52,.8),
    body('M64 61Q63 47 73 43Q85 39 88 49L86 73L79 69L73 77L69 70Z'),*eye(75,55,5,7,1),
    body('M36 20L41 9L48 19L59 16L57 26L67 30L55 36L48 32L39 37L40 27L31 24Z',2.5),c(48,24,3),star(15,13,5),star(83,25,5),s('M11 81Q45 91 85 81',2)
], 'The many-agent brand illustration.',
'Three mismatched night-shift creatures share one stage. Their shared ink and uneven mass make a crew, without turning every agent into the same robot head.')
icon('brand-mesh','Local hotline','Brand',[
    s('M27 30C6 9 66 3 73 30C94 48 76 90 39 83C14 79 37 53 56 65',4),
    *[s(f'M{32+i*5} {79-i*.2}q-4 -9 3 -12q7 -2 4 6',1.8) for i in range(7)],
    body('M8 28L14 18L27 24L24 35L37 55L50 55L55 68L44 76Q22 69 8 41Z'),p('M11 26L22 23L26 29L19 37L27 53L39 61L45 57L50 66L42 71Q20 64 12 42Z'),
    body('M56 16L84 20L90 57L62 53Z'),p('M62 23L79 26L82 40L65 37Z'),word('HI',66,27,.75,fill=PAPER),
    *[c(67+i*5+j,43+j*5,1.3) for i in range(3) for j in range(2)],star(10,78,5)
], 'Private device-to-device connection, imagined as a hotline.',
'A curled telephone lead joins a receiver and a pocket terminal. This is a local circuit with a tangible cable, not a cloud-service metaphor.')
icon('brand-library','Save your weird','Brand',[
    body('M14 30L54 15L83 29L82 74L42 88L12 68Z'),p('M42 50L83 29L82 74L42 88Z'),
    body('M18 28L53 18L52 54L18 63Z'),p('M24 28L46 22L46 35L25 41Z'),word('VF',26,27,.8,fill=PAPER),
    body('M29 30L64 22L65 59L30 71Z'),p('M35 30L56 26L58 43L36 48Z'),r(47,28,6,10,fill=PAPER),
    body('M11 47L42 58L84 43L82 74L42 88L12 68Z'),s('M42 58V85M16 53L36 60',2),word('KEEP',17,59,.65),
    body('M48 62L72 54L72 69L48 77Z',1.5),word('ODD',52,64,.8),star(79,12,7),star(10,16,4)
], 'A collectible brand sticker for saved creations.',
'A deep record-shop crate holds floppy artifacts with KEEP / ODD labels. Heavy side shadows and small label lettering turn “library” into something worth collecting.')

# Twelve people-sized characters. These are proposals, not replacements for account faces.
icon('identity-pebble','Moon rock','Identity',[
    p('M27 75L28 83Q12 88 14 92L38 92L40 75Z M57 73L61 83Q79 82 79 89L54 91L50 74Z'),
    body('M14 51L20 27L43 13L68 21L82 44L73 70L50 80L27 72Z',3.5),
    p('M17 52L29 66L49 74L72 64L70 72L50 81L27 73Z'),
    body('M22 33L47 36L48 48L31 48Z',2),body('M49 36L74 32L70 46L54 48Z',2),
    p('M25 35L46 38L45 46L32 45Z M52 38L71 35L67 43L55 45Z'),s('M46 37L51 38',3),
    s('M36 60Q47 67 59 56',3),oval(59,26,5,2.5,1.5),oval(28,55,4,2,1.3),*hatch(66,52,4,3,8),star(12,13,5)
], 'A low-key personal character, chosen by its owner.',
'A moon-rock slacker wears angular shades and tiny boots. Chipped facets, crater lines, and an uneven smile give the silhouette a specific attitude.')
icon('identity-seed','Bean machine','Identity',[
    p('M31 76L25 84L36 90L43 85L39 74Z M56 76L58 86L76 86L75 79L64 75Z'),
    s('M22 53Q8 52 8 66L16 70M76 46Q89 46 86 58',3),
    body('M66 13C89 24 83 61 62 77C40 96 15 73 19 48C21 24 45 3 66 13Z',3.5),
    s('M61 17C39 28 61 49 36 74',4),*eye(35,38,7,10,2),*eye(60,36,7,10,-1),
    s('M51 60Q61 64 68 55',3),s('M22 60L26 63M70 20L74 27',1.5),star(9,26,5),star(88,75,4)
], 'A mischievous personal emblem for long nights in a field.',
'A coffee bean becomes a lopsided worker with rubber arms. Its long carved seam gives it a strong shape even before the two suspicious eyes resolve.')
icon('identity-sprout','Root access','Identity',[
    body('M23 34L68 31L78 42L76 82L21 86Z',3.5),p('M30 36L62 34L62 50L30 53Z'),
    r(49,35,7,12,fill=PAPER),box(30,58,37,19,1,2),*eye(41,65,4,5,1),*eye(56,65,4,5,-1),
    s('M44 74Q50 77 55 72',2),s('M48 35Q49 23 43 18',4),
    body('M46 23Q22 26 21 11Q40 6 46 23Z',2.8),p('M44 22Q38 13 26 13Q36 18 44 22Z'),
    body('M48 24Q52 4 75 10Q74 29 48 24Z',2.8),s('M53 21L68 14',2),
    s('M20 83L12 88M76 78L86 83',3),star(10,41,5),star(84,25,4)
], 'An identity sticker about making your own things grow.',
'Fresh leaves sprout from a battered floppy disk. The collision of obsolete storage and living growth is deliberately stranger than a conventional leaf badge.')
icon('identity-canopy','Nightcap','Identity',[
    body('M35 50Q42 65 26 80Q46 91 68 77Q55 67 60 47Z',3.2),*eye(42,65,5,7,1),*eye(55,63,5,7,-1),
    s('M42 79Q49 82 55 75',2.5),
    body('M10 48C13 28 25 10 47 11C70 8 83 26 87 43Q54 67 10 48Z',3.5),
    p('M11 47Q53 55 86 41L87 46Q48 65 11 52Z'),oval(47,23,10,5,2),oval(25,34,6,4,2),oval(70,31,7,5,2),
    *[s(f'M{25+i*7} 50L{39+i*3} 56',1.2) for i in range(7)],s('M19 80L14 84M78 72L85 76',2),star(80,11,4)
], 'A crooked, nocturnal personal character.',
'A mushroom shelters a watchful stem. Uneven gills, broad ink under the cap, and offset eye heights make it feel like a screen-printed club sticker.')
icon('identity-shell','Shell dweller','Identity',[
    body('M16 71Q7 58 22 49L66 46Q82 45 88 60L81 69L72 62L76 77L66 80L60 69L28 78Z',3),
    body('M25 51C14 20 40 9 62 16C88 24 88 48 64 61L28 66Z',3.5),
    s('M35 51C25 32 42 19 56 25C72 31 69 48 54 50C41 53 37 38 47 34C57 29 61 41 51 41',3.5),
    s('M23 52L17 38M34 51L32 37',3),*eye(17,32,6,8,1),*eye(32,31,6,8,1),
    s('M16 60L8 64M21 66L11 76M34 72L31 85M52 71L57 86',3),*hatch(64,27,4,3,11),star(10,14,4)
], 'A personal character that carries its workspace along.',
'A hermit creature wears a spiralling, cable-like shell. Antenna eyes and scrappy legs give “take your field with you” a comic body.')
icon('identity-ridge','Peak weird','Identity',[
    body('M11 78L30 26L44 44L58 11L88 79Z',3.5),p('M30 27L39 51L28 45L22 50Z M58 12L72 49L60 37L51 44L48 33Z'),
    body('M32 60Q50 41 72 58Q54 77 32 60Z',2.5),oval(52,59,8,11,2),c(52,60,5),c(54,56,1.5,fill=PAPER),
    *hatch(73,59,5,2.2,15),s('M19 81L78 84',2),s('M9 37L16 41M8 48L15 48M77 20L83 15',2.5),star(23,12,5)
], 'A personal emblem for somebody who likes the strange route.',
'A mountain wears a single attentive eye. Black snowcaps, oblique hatching, and an impossible face turn a landscape pictogram into a character.')
icon('identity-kite','High flyer','Identity',[
    body('M50 8L83 32L54 66L20 38Z',3.5),p('M50 8L54 66L20 38Z'),
    body('M28 35Q48 20 70 33Q49 48 28 35Z',2.2),oval(48,35,7,10,2),c(49,36,4),
    s('M54 66C35 58 62 90 32 85C17 84 19 74 10 77',3),
    p('M44 73L34 65L33 76L44 73L51 82L54 71Z M27 85L20 80L20 90L27 85L35 91L35 82Z'),star(12,19,6),star(79,62,7),s('M72 17L76 14M79 23L86 22',2)
], 'A personal sticker with a slightly surreal outlook.',
'A watchful diamond floats on an unruly ribbon. The big half-ink body nods to graphic kite construction while the eye and bow ties make it collectible.')
icon('identity-sail','Out of office','Identity',[
    oval(48,76,38,11,2.5),p('M13 79Q52 90 83 75Q76 87 49 89Q21 88 13 79Z'),
    p('M48 69L54 25L62 26L57 70Z'),
    body('M57 27Q40 15 21 28Q26 9 52 15Q49 4 40 5Q64 0 64 20Q82 5 89 24Q73 19 64 30Q79 28 87 43Q64 33 57 27Z',2.2),
    s('M56 40L61 42M54 52L59 54',2,stroke=PAPER),
    body('M16 42Q30 57 49 50L44 69Q25 68 16 42Z',2.5),*eye(29,54,4,5,1),*eye(40,57,4,5,-1),
    s('M14 39L18 41M48 50L57 45',2.5),star(13,13,5)
], 'An intentionally relaxed personal character.',
'A tiny watcher takes a hammock break under a bent palm. The floating island is an escape hatch for a personal field, drawn like a souvenir decal.')
icon('identity-orbit','Space cadet','Identity',[
    body('M14 64C-1 47 57 15 85 27C107 40 33 84 14 64Z',2.5),
    p('M16 62C9 54 65 23 81 30C76 35 70 38 66 42L40 53Z'),
    linecircle(48,44,25,3.5),p('M22 39L46 37L46 52L29 52Z M49 37L72 34L69 50L51 51Z'),
    s('M45 41L50 40',3),s('M34 60Q48 68 59 57',3),
    body('M8 54Q32 70 86 29L89 35Q52 73 22 70Q10 68 8 54Z',2.4),
    s('M31 25Q44 17 58 23',1.6),star(14,16,6),star(82,74,8),c(65,85,2.5)
], 'The personal emblem for a field with its head in orbit.',
'A planet in sunglasses peers over its own ring. The overlapping ring, scratched highlight, and uneven smile carry a cheeky space-age mood.')
icon('identity-knot','Brain cable','Identity',[
    body('M18 44Q6 31 20 22Q14 8 35 13Q44 3 56 13Q77 8 78 28Q92 35 79 48Q85 62 67 68Q58 78 47 69Q29 80 24 63Q12 62 18 44Z',3.5),
    s('M22 26Q33 23 30 36Q19 44 28 50M38 18Q47 27 36 33M61 18Q52 30 66 34M71 28Q75 42 65 45M37 55Q41 62 35 67M56 56Q66 55 67 63',2.2),
    *eye(40,44,6,9,1),*eye(56,44,6,9,-1),
    s('M36 71C13 73 16 90 41 85C63 82 66 84 71 85',4),body('M68 77L82 77L84 88L70 91Z',2),
    s('M81 80L88 77M84 85L91 82',3),star(7,67,4),star(87,12,5)
], 'A personal sticker for tangled, connected thinking.',
'Brain folds become a patch cable with a physical jack. The silly literal collision has more identity than an abstract network diagram.')
icon('identity-wave','Good current','Identity',[
    body('M9 77C12 41 32 14 59 17C80 20 86 38 71 49C76 31 51 25 43 48C60 47 55 78 87 66L82 82L13 83Z',3.5),
    p('M14 77Q29 53 43 48Q48 68 65 75L81 75L78 81L14 81Z'),
    *eye(37,41,6,8,1),*eye(53,37,6,8,-1),
    s('M20 64Q25 51 30 48M23 71Q26 62 31 59M66 24L72 30',1.7),s('M15 88H78',2),
    body('M17 16Q5 31 15 32Q25 32 17 16Z',2),c(76,13,3),star(86,49,5)
], 'A cheeky surf-influenced personal emblem.',
'A curling current has a sidelong expression and a heavy ink belly. Separated spray, scratched contour lines, and a flat ink base give it decal weight.')
icon('identity-lantern','Midnight oil','Identity',[
    s('M29 24C23 0 68 0 67 24',4),body('M27 25L69 24L72 35L69 81Q47 91 26 80L22 36Z',3.5),
    p('M27 27L69 26L68 34L25 36Z M27 77Q48 86 69 77V83Q48 92 27 83Z'),
    body('M39 71C19 55 42 49 43 35C58 47 56 48 53 54C72 53 68 72 50 75Z',2.2),
    body('M32 59Q47 44 62 59Q47 72 32 59Z',2),c(47,59,6),c(49,57,1.5,fill=PAPER),s('M28 43L28 61M65 39L66 50',1.4),
    star(11,47,6),star(85,27,7),s('M78 62L86 67M13 76L18 73',2)
], 'A nocturnal personal sticker.',
'A watchful flame burns inside a jam-jar lantern. Wire handles, bottle reflections, and a dark base make this a strange physical keepsake.')

# Agent roles: eight working characters, independent of vendors and reported state.
icon('agent-loop','Loop trooper','Agents',[
    s('M27 70L20 84M62 70L69 83',5),p('M20 79Q7 78 9 88L31 88L29 80Z M65 80L67 89L87 88Q89 80 77 79Z'),
    body('M15 28L71 20L81 31L77 70L22 76L12 64Z',3.5),p('M24 36L66 31L67 59L23 64Z'),
    *eye(44,47,12,12,2),s('M37 64L60 61',2),c(71,61,2),
    s('M47 22L45 11',3),c(45,8,4),s('M13 43Q0 42 7 64M78 41Q90 44 83 61',3),
    p('M76 8Q91 18 84 31L78 28L84 39L94 29L88 29Q97 15 82 5Z'),star(12,13,4)
], 'A general agent-role character, assigned explicitly by a user.',
'One cyclopean CRT, two rubber legs, and a loop arrow. The machine has a memorable body without pretending to be a vendor identity or an online indicator.')
icon('agent-scout','Deep diver','Agents',[
    body('M11 55Q10 36 31 32L66 31Q89 34 86 54Q85 72 65 73L31 78Q11 77 11 55Z',3.5),
    p('M73 35L90 28L91 45L83 51L90 63L88 78L72 70Z'),
    body('M35 32L35 10L58 10L60 23L46 23L47 32Z',3),p('M45 11H58V22H45Z'),
    oval(35,53,15,16,3),*eye(35,54,10,11,2),
    *[c(32+i*14,69-i*1.3,1.4) for i in range(3)],s('M55 45L71 43M57 51L70 49M58 57L72 55',2),
    c(10,24,5,fill='none',stroke=INK,strokeWidth=2),c(20,12,2.5),s('M10 85Q25 81 40 85Q58 89 78 82',2)
], 'An optional role for reconnaissance and research.',
'A one-eyed submarine looks beneath the surface through a periscope. Rivets, louvers, and drifting bubbles give “scout” its own little machine.')
icon('agent-maker','Hot hands','Agents',[
    p('M54 5L25 43L45 45L36 77L78 30L56 31L67 8Z'),
    body('M18 66L15 52Q8 41 13 38Q19 35 28 45L32 24Q33 18 38 20L37 41L45 20Q48 15 52 20L47 45L57 28Q61 23 65 28L56 49L66 40Q72 37 75 43L67 58Q64 66 50 74L27 79Z',3.5),
    s('M30 48Q43 47 46 62M45 47L42 57M54 50L51 60',2),body('M22 74L51 70L55 87L27 91Z',3),
    *checkers(29,79,7,2,2.7),star(12,17,6),star(85,62,6),s('M72 12L78 8M82 19L88 16',2.4)
], 'A maker role for an agent assigned to build.',
'A four-finger workshop glove catches a lightning bolt. Thick creases and a checker cuff suggest hands-on making, with a touch of hot-rod decal energy.')
icon('agent-weaver','Patch worker','Agents',[
    s('M19 23C6 0 91 8 77 29C69 44 40 9 28 29',3),
    body('M13 28L77 22L85 31L83 70L19 78L10 68Z',3.5),p('M19 33L74 28L77 55L17 62Z'),
    linecircle(31,45,10,2),linecircle(63,41,10,2),*eye(31,45,5,6,1),*eye(63,41,5,6,-1),
    body('M27 61L65 56L72 69L21 75Z',2),s('M35 61L34 70M58 59L59 67',2),
    c(17,30,1.2),c(77,26,1.2),c(16,67,1.2),c(77,64,1.2),
    s('M36 77C19 87 76 97 77 82C80 67 42 88 46 76',3),star(8,17,4),star(88,80,5)
], 'An agent-role emblem for assembling and connecting pieces.',
'A cassette unspools into an unruly loop. Twin reel eyes and layered tape crossings give orchestration a handmade, patched-together image.')
icon('agent-reviewer','Sharp eye','Agents',[
    p('M60 58L84 77Q91 83 83 90Q78 94 72 87L52 66Z'),
    linecircle(43,39,29,3.5),linecircle(43,39,23,1.5),
    body('M20 39Q41 15 66 36Q45 65 20 39Z',2.5),oval(43,39,9,14,2.5),c(44,40,6),c(47,36,2,fill=PAPER),
    s('M27 20Q39 12 51 17M31 64L24 70',1.7),*hatch(66,72,4,3,8),star(80,14,7),star(12,76,5)
], 'A role for review and careful inspection.',
'A loupe magnifies a wary organic eye, not a checkmark. The black handle and double lens rim make a usable object; rays add sticker personality.')
icon('agent-keeper','Memory keeper','Agents',[
    body('M17 13L67 10L80 22L77 79L14 85Z',3.5),p('M27 13L60 11L61 35L26 38Z'),r(47,14,8,17,fill=PAPER),
    box(24,44,44,30,1,2.5),*eye(37,51,6,8,1),*eye(54,50,6,8,-1),
    p('M29 64Q47 73 64 61L62 69Q46 80 31 70Z'),s('M37 66L37 72M47 68L47 74M57 65L57 70',2,stroke=PAPER),
    p('M19 81L14 91L33 90L36 82Z M57 80L60 89L80 86L72 77Z'),star(84,11,5),s('M9 32L4 28M86 47L91 44',2.5)
], 'An optional role for preserving and retrieving work.',
'A toothed floppy guards its label window. The steel shutter, label screws, and stamped grin transform an archive metaphor into a collectible character.')
icon('agent-runner','Fast forward','Agents',[
    body('M20 54L29 27L48 35L59 58L81 60Q91 62 88 75L77 81L22 82Q8 75 14 62Z',3.5),
    p('M15 65Q24 70 47 66L75 68L86 64L89 71L79 79L22 81L13 74Z'),
    body('M30 48L17 18L38 33L36 8L54 27L58 13L64 47L52 62Z',2.6),
    s('M24 27L42 49M41 20L50 43M58 28L58 47',2),
    s('M30 54L42 58M27 60L38 63',3),c(28,86,5),c(72,84,5),s('M4 43L17 43M5 52L12 52M4 34L12 34',3),star(82,32,6)
], 'A role emblem for an agent assigned to carry out a run.',
'A winged skate shoe has thick soles, fast laces, and little wheels. It suggests motion through a tangible counterculture object, rather than another play triangle.')
icon('agent-conductor','Switch doctor','Agents',[
    body('M17 24L76 12L88 26L82 76L24 88L10 74Z',3.5),p('M76 13L87 25L82 76L73 66Z'),
    *[s(f'M{31+i*15} {33-i*3}L{26+i*15} {68-i*3}',2.7) for i in range(3)],
    box(24,39,14,8,1,2),box(38,54,14,8,1,2),box(56,27,14,8,1,2),
    *[linecircle(31+i*16,77-i*3,3,1.8) for i in range(3)],
    s('M33 76C38 49 3 13 25 8C45 2 48 41 58 48',3),
    body('M55 42L66 43L66 57L55 58Z',2),s('M59 57L59 62M64 57L64 62',2),star(85,9,4)
], 'An optional agent role for coordinating a group of workers.',
'A wonky patch mixer routes its own cable. Faders, sockets, perspective, and one physical connection make the coordination metaphor tactile.')

# Sixteen objects from a personal, programmable desk. Scale drawing blocks down to 64 units.
def workspace(name,label,nodes,purpose,idea):
    icon(name,label,'Workspace',move(nodes,4,4,.64),purpose,idea,grid=72,minimum=32)
workspace('field','Open field',[
    body('M12 28L55 11L87 32L46 51Z'),p('M12 28L46 51V80L12 58Z'),body('M46 51L87 32L85 62L46 80Z'),
    *[s(f'M{20+i*8} {25-i*3}L{55+i*7} {48-i*4}',1.4) for i in range(4)],
    *[s(f'M{20+i*8} {33+i*5}L{58+i*8} {15+i*5}',1.4) for i in range(4)],
    s('M46 51L46 80',2),star(13,12,6),star(86,80,5)
], 'The spatial workspace.', 'An isometric checker field becomes a little stage, with a deep black edge and an open top.')
workspace('terminal','Terminal',crt(), 'A terminal session.', 'A skewed CRT cabinet, glass screen, ventilation cuts, and pedestal give the prompt the physicality of old desktop hardware.')
workspace('browser','World wide weird',[
    body('M13 18L77 13L84 21L81 77L13 82Z'),p('M13 18L77 13L76 28L13 33Z'),c(21,24,2,fill=PAPER),c(28,23,2,fill=PAPER),c(35,23,2,fill=PAPER),
    linecircle(47,54,20,2.5),oval(47,54,9,20,1.5),s('M27 54H67M30 44H64M30 64H64',1.4),
    p('M70 62L88 74L78 76L76 87Z'),star(10,9,4)
], 'A browser view.', 'A wire globe lives in a tilted early-web window; one oversized cursor points into its lower corner.')
workspace('project','Work in progress',[
    body('M11 26L34 21L45 30L80 24L84 75L17 85Z'),p('M11 26L34 21L44 30L18 36Z'),
    body('M18 43L91 35L76 79L13 87Z'),p('M17 76L77 69L76 80L13 87Z'),word('WIP',31,51,1.5),s('M29 66L64 62',2),
    *hatch(63,38,5,3,6)
], 'A project collection.', 'An overstuffed tab folder carries a WIP stencil and a strong offset underside, like a label from a workshop shelf.')
workspace('worktree','Branch office',[
    p('M46 48L46 77H55V48Z'),s('M51 52L29 38L24 21M51 51L72 31L73 18',5),
    body('M9 12L33 9L37 28L12 31Z'),p('M14 17L27 15L28 20L15 22Z'),
    body('M62 6L85 9L85 27L61 24Z'),p('M66 13L79 14L79 19L66 18Z'),
    body('M28 74L74 69L83 79L39 88L25 83Z'),*checkers(40,77,7,2,2.5),star(12,61,6)
], 'A project worktree.', 'Two little terminal branches grow out of a desktop trunk: a branch office, made literal.')
workspace('document','Hard copy',[
    p('M27 14L76 18L86 83L32 88Z'),body('M18 8L62 11L76 26L73 81L15 77Z'),body('M62 11L61 28L76 26Z',2),
    *[s(f'M26 {36+i*8}L{61-(i%2)*8} {38+i*8}',2.4) for i in range(4)],
    *[c(20,25+i*10,1.5) for i in range(5)]
], 'A document or text artifact.', 'A perforated tractor-feed sheet, curled corner, and black duplicate underneath borrow the language of physical output.')
workspace('note','Leave a note',[
    p('M23 15L82 19L79 82L21 78Z'),body('M14 13L72 9L80 65L58 86L16 78Z'),
    body('M57 64L80 65L58 86Z',2),s('M26 31L59 29M26 41L65 38M26 51L52 49',2.5),
    body('M31 6L51 5L54 19L32 21Z',1.5),*hatch(37,7,4,3,10)
], 'An informal note.', 'A dog-eared scrap is held by a torn strip of tape. The lifted corner and offset shadow add a tactile print-shop feel.')
workspace('artifact','Odd object',[
    body('M27 12L72 19L73 33L25 32Z'),p('M25 19L74 26L72 32L24 25Z'),
    body('M27 31L72 33L81 71Q48 94 17 71Z'),
    body('M30 48L49 39L68 51L48 61Z',2),p('M30 48L48 61L48 76L30 63Z'),body('M48 61L68 51L66 67L48 76Z',2),
    s('M25 39L23 60M74 55L76 63',1.4),star(10,20,5),star(84,13,4)
], 'A saved creation.', 'An impossible little object is bottled like a specimen. Thick glass, a screw lid, and solid cube shadow make the artifact feel worth keeping.')
workspace('history','Rewind',[
    body('M15 23L78 14L84 24L81 74L18 83Z'),p('M23 34L73 27L72 55L24 63Z'),
    p('M39 38L27 49L39 56Z M56 35L44 46L56 53Z',fill=PAPER),
    body('M28 67L67 61L72 73L24 81Z',2),linecircle(34,71,3,1.5),linecircle(61,68,3,1.5),
    s('M28 20Q20 2 69 8Q87 10 74 17',2.5)
], 'Recorded work and previous events.', 'A cassette with two reverse wedges carries history as a physical rewind, with an escaped loop of tape.')
workspace('devices','Pocket + desk',[
    *move(crt(),-1,0,.76),
    body('M61 44L84 40L88 81L62 86Z'),p('M65 49L80 47L81 62L65 64Z'),
    *[c(68+i*5,69+j*5,1.2) for i in range(3) for j in range(2)],s('M72 41L69 24',2.5),c(69,22,2)
], 'Your available devices.', 'A small brick handset stands beside the same CRT used elsewhere in the collection, tying the devices into one hardware era.')
workspace('mesh','Private line',[
    s('M27 26C83 3 95 39 74 50C57 59 49 36 34 44C9 60 19 85 72 78',5),
    *[s(f'M{33+i*5} 46q-8 4 -4 11q7 7 10 0',2) for i in range(5)],
    body('M11 12L33 13L33 32L11 32Z'),s('M15 11V4M28 11V4',4),p('M15 20H29V27H15Z'),
    body('M68 69L88 67L90 84L69 88Z'),s('M87 72L94 71M89 79L95 78',3)
], 'The private peer mesh.', 'A coiled patch lead joins two tangible endpoints. The cable is intentionally unruly; the network remains personal and inspectable.')
workspace('plugin','Plug in',[
    body('M29 28L65 25L75 43L61 63L42 68L24 49Z'),p('M25 46L42 58L61 54L61 63L42 69L25 52Z'),
    s('M37 28L30 10M55 26L48 8',6),s('M48 66C49 93 88 91 87 71',5),
    p('M36 42L49 35L54 40L48 45L57 47L51 54L40 49Z'),star(80,23,6),star(15,73,4)
], 'A plugin contribution.', 'An angled two-prong plug gets a lightning notch and a looped cord, using the heavy silhouette of a hardware-shop sticker.')
workspace('library','Record crate',[
    body('M12 43L53 28L85 39L83 78L42 89L11  72Z'),
    body('M18 22L41 16L44 58L19 66Z'),p('M23 26L35 23L37 36L24 40Z'),
    body('M41 15L67 18L65 61L42 59Z'),linecircle(54,38,8,2),c(54,38,2),
    body('M59 26L81 21L87 63L64 69Z'),*hatch(66,34,4,3,14),
    body('M11 51L42 63L87 46L83 78L42 89L11 72Z'),s('M42 63V88',2),word('VF',20, 61,1)
], 'Saved work and reusable tools.', 'A record-store crate mixes cartridges, a disc, and hard-copy sleeves. The collection has accumulated personality.')
workspace('godview','Eyes on the field',[
    body('M7 44Q43 3 90 40Q52 84 7 44Z',3.5),oval(49,43,20,25,3),
    p('M42 23L58 22L63 52L36 53Z'),p('M41 29L56 27L57 42L40 44Z',fill=PAPER),
    s('M44 32L50 36L44 40',1.8),s('M15 26L10 18M28 14L25 6M69 12L75 6M86 23L92 17',3),
    s('M20 67L17 76M43 77L42 86M68 72L73 81',2)
], 'Supervision across agent work.', 'An oversized watching eye encloses a terminal pupil. Eyelash-like rays lend drama; observed status still belongs to the accompanying words.')
workspace('conversation','Back channel',[
    body('M12 15L64 13L65 53L35 55L18 70L18 53L11 53Z'),
    *[c(25+i*13,35,3) for i in range(3)],
    body('M37 44L85 39L87 75L76 76L76 89L62 79L38 83Z'),
    s('M49 55L75 52M49 65L68 62',2.5)
], 'A conversation surface.', 'Two tilted speech slips overlap like pasted editorial balloons, with broad ink dots and sharply cut tails.')
workspace('panes','Window shopping',[
    body('M25 9L85 17L80 71L21 63Z'),p('M25 10L85 17L83 31L23 23Z'),
    body('M10 31L68 24L76 80L17 89Z'),p('M11 32L68 25L70 38L13 45Z'),
    c(19,37,1.7,fill=PAPER),c(26,36,1.7,fill=PAPER),s('M43 44L48 80M18 63L70 56',2)
], 'A multi-pane view.', 'Layered early-computer windows lean against each other. The solid title bars and uneven panel divisions make the geometry feel printed.')

# Controls: compact stamps with positive/negative mass instead of generic monoline strokes.
def control(name,label,nodes,idea):
    icon(name,label,'Controls',move(nodes,8,8),f'{label} action; the button must supply a clear accessible label.',idea,grid=48,minimum=24)
control('add','Add',[p('M13 2L21 3L20 13L31 12L30 21L20 20L21 31L12 30L13 20L2 21L3 12L13 13Z')], 'A squat, slightly misregistered printer’s cross; generous solid mass survives a small button.')
control('remove','Remove',[p('M3 12L30 10L29 20L2 21Z'),s('M7 15L25 14',1,stroke=PAPER)], 'A carved dash with an off-square baseline and one highlight cut.')
control('close','Close',[p('M7 1L16 11L25 2L31 8L21 17L30 26L24 31L15 22L6 31L1 25L10 16L1 7Z')], 'Two blunt, uneven strokes cross like a block-print cancellation mark.')
control('select','Point here',[p('M4 1L31 20L19 23L14 32Z'),p('M8 7L23 18L15 17L12 25Z',fill=PAPER)], 'An oversized early-desktop cursor gets a white interior slash and a deep black heel.')
control('pan','Grab it',[
    body('M8 29L3 16Q2 12 5 12L9 16L8 5Q8 2 11 3L13 14L14 3Q16 0 18 3L18 14L21 4Q24 2 25 6L23 16L27 10Q30 8 31 12L28 24L23 30Z',2.2),s('M12 18Q19 16 21 23',1.5),p('M9 26L25 25L23 31L11 31Z')], 'A rubber-hose glove with four readable fingers, a deep cuff, and a single palm crease.')
for name,label,sign in [('zoom-in','Zoom in',1),('zoom-out','Zoom out',0)]:
    control(name,label,[p('M20 18L32 27L27 32L17 22Z'),linecircle(12,12,10,2.8),s('M7 12H17',2.5),*([s('M12 7V17',2.5)] if sign else [])], 'A magnifying lens with a fat diagonal handle and a broad optical rim.')
control('fit','Fit the field',[p('M1 12V2H12V7H7V12Z M20 2H31V12H26V7H20Z M31 20V31H20V26H26V20Z M12 31H1V20H7V26H12Z'),p('M11 14L21 11L23 21L12 23Z')], 'Four heavy crop corners bracket an off-axis card, borrowing the printer’s registration language.')
control('focus','Focus',[body('M1 16Q15 0 31 15Q17 33 1 16Z',2),linecircle(16,16,7,2),c(17,16,4),c(19,13,1.3,fill=PAPER)], 'A sharp eye with a cut pupil uses a bold silhouette rather than four thin targeting corners.')
control('back','Go back',[p('M17 1L1 16L17 31L17 22L31 23L30 10L17 11Z'),s('M9 16H25',1.4,stroke=PAPER)], 'A sign-painter’s arrow with an oversized shoulder and a single incision.')
control('chevron-down','Open',[p('M2 6L16 18L29 5L32 14L16 30L0 15Z')], 'An exaggerated folded chevron reads like a torn strip of black tape.')
control('send','Send it',[p('M1 10L31 1L24 31L14 23L9 27L9 18Z'),p('M6 11L25 5L12 17Z M14 21L24 8L19 24Z',fill=PAPER)], 'A hard-folded paper dart with a double white seam; a familiar action with more paper and shadow.')
control('run','Let it run',[p('M5 2L30 16L5 31Z'),p('M10 8L21 16L10 24Z',fill=PAPER)], 'A heavy, slightly uneven play stamp with a wedge of paper inside.')
control('pause','Hold on',[p('M3 3L13 1L12 30L2 31Z M21 2L31 4L29 31L19 29Z')], 'Two slanted, cut-paper bars give a familiar control a rougher rhythm.')
control('stop','Stop',[p('M3 2L30 4L28 31L1 28Z'),s('M7 6L24 7',1.4,stroke=PAPER)], 'A solid off-square brake block with a small scratched highlight.')
control('retry','One more time',[p('M7 13C5 4 19-2 27 7L31 3L31 17L17 15L22 11C17 6 10 9 12 15Z M25 20C28 30 12 36 5 25L1 29L1 15L15 18L10 22C14 28 22 25 21 19Z')], 'Two lumpy arrows chase one another, close to the physical feel of a hand-carved stamp.')
control('settings','Tune it',[s('M5 3V29M16 3V29M27 3V29',2.7),body('M1 7L10 6L10 13L1 14Z',1.5),p('M11 19L21 18V25L11 26Z'),body('M22 9H32V16H22Z',1.5)], 'Three mixer faders continue the collection’s analog-console language at button scale.')
control('more','More',[p('M2 11L9 10L10 19L2 20Z M13 12L20 10L21 20L13 21Z M24 11L31 12L31 21L23 20Z')], 'Three uneven ink blocks keep the familiar ellipsis while rejecting perfect dot geometry.')
control('copy','Duplicate',[p('M12 1L29 4L31 23L12 26Z'),body('M2 7L21 5L24 29L4 31Z',2),s('M7 13L17 12M8 18L18 17M8 23L15 22',1.7)], 'Two offset paper slips, with a deep solid back sheet and three typewriter-like cuts.')
control('external-link','Break out',[p('M15 1L31 1L31 17L25 12L15 22L10 17L20 7Z'),s('M12 6H3V29H26V21',3.3)], 'A fat north-east arrow breaks through the open corner of a square frame.')
control('trash','Bin it',[body('M7 11L27 10L24 30L10 31Z',2),p('M3 7L29 4L30 10L3 13Z'),s('M12 6L13 2L21 1L22 5',2.5),s('M13 16L14 26M21 15L20 26',2)], 'A crooked metal wastebasket has a loose lid, visible handle, and cut ventilation lines.')
control('sun','Day shift',[p(burst(16,16,16,11,12)),c(16,16,7,fill=PAPER),c(13,15,1.5),c(19,15,1.5),s('M12 19Q16 23 20 18',1.3)], 'A smiling sun inside a spiky printer’s rosette turns the theme control into a miniature sticker.')
control('moon','Night shift',[p('M22 1C7-1-3 17 7 27C18 38 32 27 32 19C18 27 10 9 22 1Z'),star(27,7,4),s('M8 17Q7 22 12 26',1.2,stroke=PAPER)], 'A fat crescent with one crescent-shaped scratch and a sharp four-point star.')
control('edit','Make a mark',[body('M5 21L21 2L30 10L13 29L2 32Z',2),p('M21 2L25 0L33 7L30 10Z'),p('M2 32L5 21L13 29Z'),s('M10 21L24 6',1.4)], 'A faceted carpenter’s pencil shows its wood, lead, and end cap instead of a skeletal diagonal.')
control('publish','Put it out',[body('M8 11L25 3L28 25L10 21Z',2),p('M4 11L9 11L11 22L5 22Z M12 21L18 22L19 31L13 31Z'),s('M30 7L34 4M31 15H35',2)], 'A little megaphone turns publishing into an announcement, with a chunky grip and a broad cone.')
control('download','Take a copy',[p('M12 1L21 2L20 15L29 14L16 27L3 15L12 15Z'),p('M1 25H7V29H26V24H32V34H1Z')], 'A fat dropping arrow meets a low tray. The slightly stepped geometry nods to early desktop dingbats.')
control('connect','Plug together',[s('M2 28L9 21M25 11L31 4',3),body('M4 14L11 7L23 19L16 26Z',2),body('M16 8L23 1L31 9L24 16Z',2),s('M14 8L17 5M23 17L26 14',2)], 'Two solid cable heads meet diagonally, retaining the physical-connection language of the mesh sticker.')
control('disconnect','Pull apart',[s('M1 31L6 26M27 5L32 0',3),body('M1 20L8 13L18 23L11 30Z',2),body('M18 5L25 0L32 7L27 15Z',2),s('M11 12L14 9M20 20L23 17',2),p('M12 3L15 6L10 9Z M29 20L31 23L25 23Z')], 'The two cable heads separate, with little rupture sparks; offline status remains a separate fact.')

# State signs: expressive stamps, always paired with explicit observed-state words.
def state(name,label,nodes,idea):
    icon(name,label,'States',move(nodes,5,5,.85),f'Observed {label.lower()} state; keep the state word and source fact visible.',idea,grid=50,minimum=28)
state('status-working','Working',[
    p(burst(24,24,23,19,16)),oval(24,24,15,15,1.8),p('M27 5L13 25L23 26L18 43L37 20L26 20Z'),s('M9 8L5 4M40 40L44 44',1.6)
], 'An electric rosette gives activity a dense, energetic stamp. Color comes from the existing working token, never from a person’s identity.')
state('status-approval','Needs you',[
    body('M3 9L43 3L46 33L28 37L16 47L16 37L6 39Z',2.8),p('M20 11L29 10L27 27L21 28Z'),c(24,33,3),s('M36 10L38 24',1.2)
], 'A tilted speech flag asks the operator for attention. It is a request, with no visual claim that approval has been given.')
state('status-waiting','Waiting',[
    p('M8 3L40 3L40 8L8 8Z M8 40L40 40L40 46L8 46Z'),body('M12 8C12 18 18 22 24 24C30 26 36 31 36 40H12C12 32 18 27 24 24C30 22 36 17 36 8Z',2.5),p('M16 11H32Q31 18 24 21Q17 18 16 11Z M15 38L24 29L33 38Z'),c(24,26,1.2)
], 'A solid wooden hourglass carries real sand, a narrow waist, and heavy end caps; waiting is still a muted state.')
state('status-idle','On a break',[
    body('M9 19L33 17L32 39Q20 46 10 39Z',2.6),s('M34 20Q49 17 44 29Q41 35 33 33',3),p('M11 20L31 19L30 24L12 26Z'),s('M16 13C8 5 25 8 19 1M27 13C19 5 36 8 29 1',2),s('M6 46H38',2)
], 'A chipped coffee mug and two smoke curls make idle a quiet break, not an error or an invented “online” badge.')
state('status-done','Done',[
    body(burst(24,24,23,20,12),2.5),p('M8 25L17 20L23 28L37 10L42 16L22 40Z')
], 'A heavy check sits inside a serrated seal. Use a green check with muted accompanying words, following the existing state policy.')
state('status-failed','Failed',[
    body('M6 7L40 4L43 38L8 44Z',2.8),p('M14 10L25 20L33 9L39 16L29 26L38 34L31 40L23 30L15 40L9 33L18 25L8 17Z'),s('M4 23L0 21M44 12L48 9',2)
], 'An emphatic block-print cancellation stays square and enclosed, separating an observed failure from the bare close button.')
state('status-unknown','Unknown',[
    body('M14 43Q3 29 11 11Q20-1 36 6Q48 16 41 38L35 35L29 44L22 38L16 45Z',2.8),word('?',19,11,2),s('M13 28L12 34',1.3)
], 'A question-mark ghost admits what is not known. It is intentionally odd but still paired with a muted, italic uncertainty label.')
state('status-offline','Off the air',[
    body('M4 16L42 11L46 39L7 46Z',2.7),p('M10 21L28 18L30 35L12 38Z'),*hatch(15,23,4,3,10),c(37,22,2.3),c(38,31,2.3),s('M31 14L24 3',2),p('M7 2L46 39L42 44L3 6Z')
], 'A silent portable radio gets a diagonal cancellation. Offline remains a connectivity observation, shown in muted ink.')

assert len(icons)==78,len(icons)
assert len({i['name'] for i in icons})==78
# Leave safe room around the detailed sticker drawings for their die-cut keyline.
for item in icons:
    if item['grid']==96:
        item['shapes']=move(item['shapes'],8,8)
        item['grid']=112

ATTRS={'strokeWidth':'stroke-width','strokeLinecap':'stroke-linecap','strokeLinejoin':'stroke-linejoin','fillRule':'fill-rule'}

def render_svg(item,finish='sticker',title=True):
    def shapes(under=False):
        output=[]
        for shape in item['shapes']:
            attrs={key:('#fff' if value==PAPER else value) for key,value in shape['attrs'].items()}
            if under:
                attrs.update(fill='#fff',stroke='#fff',strokeWidth=item['grid']*.072,strokeLinecap='round',strokeLinejoin='round')
            text=' '.join(f'{ATTRS.get(k,k)}="{html.escape(str(v),quote=True)}"' for k,v in attrs.items())
            output.append(f'<{shape["tag"]} {text}/>')
        return ''.join(output)
    style='' # Portable files use explicit white; the React leaf can inherit paper.
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {item["grid"]} {item["grid"]}" fill="currentColor" stroke="none"{style}>'
            +(f'<title>{html.escape(item["label"])}</title>' if title else '')
            +(shapes(True) if finish=='sticker' else '')+shapes()+'</svg>')

def write(rel,content):
    raw=content.encode() if isinstance(content,str) else content
    EMITTED[rel]=raw
    path=ROOT/rel
    if path.exists() and path.read_bytes()==raw: return
    if options.check:
        MISMATCHES.append(rel); return
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)

def build():
    catalogue=json.dumps(icons,ensure_ascii=False,indent=2)+'\n'
    write('packages/design-kit/src/icons/catalogue.json',catalogue)
    names=json.dumps([item['name'] for item in icons])
    schema="""export const FIELD_ICON_NAMES = NAMES as const;
export type FieldIconName = (typeof FIELD_ICON_NAMES)[number];
export type FieldIconFamily = "Brand" | "Identity" | "Agents" | "Workspace" | "Controls" | "States";
export interface FieldMark {
 name: FieldIconName; label: string; family: FieldIconFamily; grid: number; mode: "solid";
 minimum: number; purpose: string; idea: string;
 shapes: readonly {tag: "path" | "circle" | "ellipse" | "rect"; attrs: Readonly<Record<string,string | number>>}[];
}
""".replace(' = NAMES as const;', ' = '+names+' as const;')
    data='// Generated by tooling/fieldmarks/generate.py — AFTER HOURS, edition 02.\n'+schema+'export const FIELD_MARKS: Record<FieldIconName,FieldMark> = '+json.dumps({i['name']:i for i in icons},ensure_ascii=False,indent=2)+';\n'
    formatted=subprocess.run([str(ROOT/'node_modules/.bin/biome'),'format','--stdin-file-path=packages/design-kit/src/icons/data.ts'],input=data,text=True,capture_output=True,check=True,cwd=ROOT).stdout
    write('packages/design-kit/src/icons/data.ts',formatted)
    assets={}
    symbols=[]
    for item in icons:
        for finish,folder in [('sticker',''),('artwork','artwork/')]:
            name=folder+item['name']+'.svg'
            assets[name]=render_svg(item,finish)+'\n'
            write('packages/design-kit/assets/fieldmarks/'+name,assets[name])
        symbol=render_svg(item,'artwork',False).replace('<svg xmlns="http://www.w3.org/2000/svg"','<symbol id="vf-'+item['name']+'"',1).replace('</svg>','</symbol>')
        symbols.append(symbol)
    assets['sprite.svg']='<svg xmlns="http://www.w3.org/2000/svg">'+''.join(symbols)+'</svg>\n'
    write('packages/design-kit/assets/fieldmarks/sprite.svg',assets['sprite.svg'])
    assets['catalogue.json']=catalogue
    assets['README.md']=(ROOT/'packages/design-kit/assets/fieldmarks/README.md').read_text()
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,content in sorted(assets.items()):
            info=zipfile.ZipInfo('vibefield-after-hours/'+name,date_time=(2026,9,22,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
            z.writestr(info,content.encode(),compresslevel=9)
    write('docs/design/vibefield-fieldmarks.zip',archive.getvalue())
    if MISMATCHES:
        print('Generated files differ:\n'+'\n'.join(MISMATCHES),file=sys.stderr);raise SystemExit(1)
    print(('Verified' if options.check else 'Generated')+' AFTER HOURS: 78 marks in sticker and artwork editions, plus sprite.')

if __name__=='__main__': build()
