"""FACE CLUB / After Hours. Original vector drawings, never emoji outlines.
Large masters use a 96-unit drawing area; small masters are separately drawn at 48.
Ink, paper, blunt contours, off-centre pupils, and deliberately uneven mass.
"""
import math
INK='currentColor'
PAPER='#fff'
faces=[]
def n(tag,**attrs): return {'tag':tag,'attrs':attrs}
def p(d,**a): return n('path',d=d,**a)
def s(d,w=3,**a): return p(d,**{'fill':'none','stroke':INK,'strokeWidth':w,'strokeLinecap':'round','strokeLinejoin':'round',**a})
def b(d,w=3.2): return p(d,fill=PAPER,stroke=INK,strokeWidth=w,strokeLinecap='round',strokeLinejoin='round')
def c(x,y,r,**a): return n('circle',cx=x,cy=y,r=r,**a)
def e(x,y,rx,ry,**a): return n('ellipse',cx=x,cy=y,rx=rx,ry=ry,**a)
def o(x,y,rx,ry,w=3): return e(x,y,rx,ry,fill=PAPER,stroke=INK,strokeWidth=w)
def q(x,y,w,h,rx=0,**a): return n('rect',x=x,y=y,width=w,height=h,rx=rx,**a)
def eye(x,y,rx=7,ry=10,look=2):
    return [o(x,y,rx,ry,2.3),e(x+look,y+2,rx*.43,ry*.6),p(f'M{x+look} {y}l3 -2v4Z',fill=PAPER)]
def sleepy(x,y,rx=8,ry=8):
    return [o(x,y,rx,ry,2.3),p(f'M{x-rx} {y}Q{x-rx} {y-ry-4} {x} {y-ry}Q{x+rx} {y-ry-2} {x+rx} {y}Z'),e(x+2,y+3,2.5,3.5),s(f'M{x-rx} {y}h{rx*2}',2)]
def hatch(x,y,num=3,gap=3,h=7): return [s(f'M{x+i*gap} {y}l-2 {h}',1.35) for i in range(num)]
def star(x,y,r=5): return p(f'M{x} {y-r}L{x+1.4} {y-1.4}L{x+r} {y}L{x+1.4} {y+1.4}L{x} {y+r}L{x-1.4} {y+1.4}L{x-r} {y}L{x-1.4} {y-1.4}Z')
def move(nodes,x=0,y=0,scale=1,angle=0): return [{'tag':v['tag'],'attrs':{**v['attrs'],'transform':f'translate({x} {y}) scale({scale}) rotate({angle} 48 48) '+v['attrs'].get('transform','')}} for v in nodes]
def add(id,emoji,label,nickname,group,idea,small_note,large,small):
    faces.append(dict(id=id,emoji=emoji,label=label,nickname=nickname,group=group,idea=idea,smallNote=small_note,large=move(large,8,8),small=move(small,4,4)))

add('fox','🦊','Fox','Sly cut','Animals',
'A wedge-shaped fox with a sideways glance, black ear tips, torn cheek fur, and a smile cut out of its muzzle.',
'The ear triangles and long white muzzle stay; cheek hatching disappears.',[
 b('M15 42L10 8L36 27Q48 21 61 28L87 9L80 46L90 54L78 58L80 68L63 72L49 87L30 77L17 65L6 57Z'),
 p('M10 8L36 27L21 32Z M87 9L80 46L68 30Z'),
 p('M19 39Q39 30 48 54Q64 32 82 40L73 57L54 68L45 66L28 58Z'),
 b('M13 53Q30 49 44 63Q60 50 80 54Q70 72 49 84Q23 71 13 53Z',2.5),
 *eye(33,47,6,9,2),*eye(63,44,6,9,-1),p('M39 64Q48 58 56 63L49 73Z'),s('M49 72L49 78Q59 78 65 71',2.2),
 s('M21 69L27 71M29 75L35 77M68 60L72 58',1.4),*hatch(44,30,3,3,6)
],[b('M5 19L3 3L17 12L25 10L33 13L45 3L41 23L46 28L33 37L24 45L11 36L2 27Z',3.3),p('M4 5L16 13L8 17Z M44 5L34 14L40 20Z M8 22L18 21L23 30L29 21L39 22L31 33H17Z'),c(16,24,2,fill=PAPER),c(32,24,2,fill=PAPER),p('M19 34H29L24 40Z')])

add('octopus','🐙','Octopus','Eight track','Animals',
'A bulbous, unimpressed octopus unwinds eight chunky arms. Tiny suckers and a curled lower arm give it the feel of a rubber-hose cartoon.',
'Eight blunt arm endings, a domed head, and two white eye cuts replace the fine suckers.',[
 b('M25 49C17 21 30 8 49 8C71 8 82 28 70 50C75 43 81 34 87 39C96 47 84 60 75 62C85 63 92 59 93 66C94 76 77 77 69 72C78 84 86 76 85 84C84 94 67 91 59 79C65 98 43 95 44 80C38 97 19 94 21 85C23 76 30 88 34 73C21 86 5 80 8 73C10 67 19 74 27 64C11 70 2 61 7 54C11 48 18 60 25 49Z'),
 p('M29 40Q45 48 69 39L67 56Q47 65 29 53Z'),*sleepy(37,37,8,10),*sleepy(57,34,8,10),
 o(48,55,5,4,2),s('M27 55Q36 64 32 74M64 57Q57 68 59 80M47 64L45 79',2.2),
 *[c(x,y,1.8) for x,y in [(16,59),(17,74),(28,87),(48,87),(74,84),(85,69),(85,49)]],*hatch(36,17,4,3,7)
],[b('M13 25C7 5 17 3 25 3C37 3 40 14 35 25L43 19Q49 23 38 32L45 33Q48 42 33 36Q42 48 28 43L25 36Q23 50 18 43L18 35Q6 48 6 39L13 32Q0 37 2 28L10 28L4 21Z',3),p('M13 18H36V27H13Z'),e(19,21,2.2,4,fill=PAPER),e(29,21,2.2,4,fill=PAPER)])

add('panda','🐼','Panda','Patch work','Animals',
'A panda with oversized vinyl-black ears and mismatched eye patches. One raised brow, one low lid, and a crooked grin break the symmetry.',
'Round ears and diagonal black eye patches carry the identity without fur marks.',[
 c(20,22,15),c(77,25,15),b('M17 34Q16 17 43 17Q76 13 82 36Q95 68 72 82Q45 95 22 77Q4 62 17 34Z'),
 e(31,48,13,18,transform='rotate(25 31 48)'),e(65,49,13,17,transform='rotate(-24 65 49)'),
 *eye(33,48,6,9,-1),*sleepy(63,48,7,9),b('M29 68Q38 57 47 62Q58 56 67 69Q60 86 46 83Q32 82 29 68Z',2),
 p('M37 63Q48 59 57 64L48 71Z'),s('M48 71V75Q59 78 62 70M47 75Q39 79 35 74',2),s('M29 30Q34 27 39 30M59 29L68 33',2.4),*hatch(20,64,3,3,6)
],[c(9,9,8),c(39,10,8),b('M7 17Q5 9 24 9Q43 9 42 24Q48 41 29 45Q9 48 4 32Z',3),e(16,25,6.5,9,transform='rotate(25 16 25)'),e(34,25,6.5,9,transform='rotate(-25 34 25)'),c(17,25,2,fill=PAPER),c(33,25,2,fill=PAPER),p('M19 35L29 35L24 41Z')])

add('penguin','🐧','Penguin','Tux deluxe','Animals',
'A leaning penguin in an ink-black tuxedo, with flared flippers, big boots, and an off-centre white shirt-front.',
'The upright black body, white bib, beak, and two wide feet remain.',[
 p('M28 72L29 83Q8 82 9 90L37 91L43 80Z M55 79L61 91L87 89Q86 81 70 80L68 73Z'),
 b('M26 32C20 4 65 1 73 28L76 44Q87 47 92 66L75 63Q82 86 50 87Q20 88 20 65L5 73Q7 49 22 44Z'),
 p('M26 32C20 4 65 1 73 28L76 44L90 64L74 59L69 74L31 75L23 59L7 69L22 43Z'),
 b('M31 30Q38 21 48 34Q55 18 65 30Q73 43 62 51Q76 70 64 79Q48 92 30 74Q21 61 34 51Q23 40 31 30Z',2),
 c(38,38,3),c(59,37,3),b('M40 45L63 43L50 54Z',2.5),s('M34 65Q48 75 65 63',2),*hatch(39,72,4,3,5),s('M28 16L24 9M36 13L36 7',2)
],[p('M13 35L9 43L1 44L3 48H21L24 41L29 47L46 45L44 41L36 40L35 34Z'),b('M12 17C8 0 39-3 37 20L46 35L36 31Q42 44 25 44Q9 43 10 31L1 37Z',3),p('M12 17C8 0 39-3 37 20L43 31L34 29L15 29L4 32Z'),b('M17 15Q22 10 25 17Q30 10 33 17L30 27Q39 39 26 40Q11 40 18 27Z',1.7),p('M21 21H32L26 28Z')])

add('owl','🦉','Owl','Graveyard shift','Animals',
'A compact owl built from two enormous, unequal eye discs, horn-like feather tufts, and a dense black wing. Its claws curl around a little branch.',
'Two open eye discs dominate a pointed, tapering body.',[
 s('M9 85L86 80',5),s('M28 80L30 88M36 79L38 87M61 78L62 86M68 77L70 84',3),
 b('M18 33L13 9L39 20Q55 15 64 22L85 11L79 40Q91 63 64 80L43 89L24 75Q5 55 18 33Z'),
 p('M68 38Q94 65 63 81L48 86Q74 67 65 47Z'),o(34,41,19,22),o(65,39,18,20),
 *eye(33,40,11,15,3),*eye(64,39,10,13,-2),p('M41 58L55 55L49 69Z'),
 s('M26 63L30 69L34 65M35 74L40 79L44 74M54 71L58 76L62 69',2),*hatch(18,18,3,3,7)
],[b('M6 17L3 3L17 10L28 9L44 3L41 19Q48 33 25 46Q0 35 6 17Z',3),o(16,22,9,11,2.4),o(34,22,9,11,2.4),e(18,22,3,5),e(32,22,3,5),p('M20 34L28 33L25 40Z')])

add('turtle','🐢','Turtle','Shell service','Animals',
'A low, domed turtle with an architectural shell, a stretchy curious neck, and blunt little feet. The shell is built from bold, irregular panels.',
'The domed shell and long side-facing neck survive; the panel map becomes three large cells.',[
 p('M23 70L19 85L32 87L38 73Z M60 69L61 85L74 84L72 67Z'),b('M15 65L5 74L22 76Z'),
 b('M60 62Q66 47 78 40Q96 31 92 50Q91 61 79 64L77 75L58 76Z'),*eye(81,44,6,8,1),s('M82 57L91 54',2),
 b('M14 67Q10 19 47 18Q73 20 76 63Q50 82 14 67Z',3.5),p('M14 64Q45 72 76 58L76 67Q43 81 14 71Z'),
 s('M26 28L37 40L31 57L16 60M37 40L55 34L69 42M55 34L51 20M55 34L62 54L74 57M31 57L47 66L62 54',2.8),*hatch(39,46,4,3,7),s('M24 81L25 85M66 79L67 84',1.5)
],[p('M11 34L8 44H18L20 36M29 35L32 44H40L36 32Z'),b('M31 28L37 18Q44 11 47 20Q48 27 40 29L39 36H31Z',2.8),c(43,20,1.8),b('M4 33Q3 9 22 9Q37 9 37 31Q21 41 4 33Z',3),s('M9 17L20 23L32 17M20 23L18 35',2.7)])

add('lion','🦁','Lion','Mane event','Animals',
'A cut-paper sunburst mane surrounds a long-nosed lion. Muzzle lobes, a theatrical chin, and cut-back eyes give the face a vintage mascot rhythm.',
'A scalloped ink mane frames a white muzzle and broad triangular nose.',[
 p('M47 3L56 11L69 7L72 18L85 20L82 32L94 43L85 52L90 68L76 73L72 88L58 84L45 95L35 84L19 87L18 72L5 68L11 55L2 43L12 32L9 19L25 17L32 5L42 12Z'),
 b('M28 28Q47 16 66 27L74 54L64 73L49 87L33 73L20 55Z'),p('M24 38L42 35L38 48L26 48Z M51 35L70 38L66 49L54 48Z'),
 *eye(34,45,5,8,1),*eye(60,45,5,8,-1),b('M28 61Q32 51 47 58Q63 50 69 61Q66 75 49 76Q30 78 28 61Z',2.3),
 p('M39 54L58 54L49 65Z'),s('M49 65V71M30 63L16 60M30 69L17 72M67 61L80 57M67 68L78 70',1.6),p('M42 77L56 77L49 87Z'),
 s('M26 16L21 28M67 18L73 29M12 44L17 54M73 78L69 67',1.5,stroke=PAPER)
],[p('M24 0L31 5L40 3L42 13L48 19L44 28L46 37L35 42L29 48L21 44L11 47L8 37L1 32L5 22L0 15L9 10L13 2Z'),b('M13 14Q25 7 35 15L38 28L31 39L23 43L12 33L9 24Z',2.6),p('M13 19H21L19 25H13Z M28 19H35V25H29Z M19 28H30L24 35Z')])

add('tiger','🐯','Tiger','Stripe type','Animals',
'A broad-cheeked tiger with fierce graphic stripes and a cheerful toothy muzzle. The forehead stripes are chunky ink wedges, not fine fur texture.',
'Four decisive stripes and a split white muzzle separate it from the lion and bear.',[
 b('M18 36Q3 30 10 14Q23 4 34 23Q48 17 61 23Q75 5 87 20Q92 30 78 38L89 50L82 60L88 65L75 77L48 89L22 78L9 65L15 55L7 49Z'),
 p('M11 17Q22 10 28 23L20 31Z M70 23Q81 13 84 24L77 32Z M43 21H55L50 44Z M22 32L39 43L33 46L19 39Z M64 40L78 30L81 39L63 46Z M12 51L33 56L24 62L12 59Z M64 55L84 48L85 57L71 63Z'),
 *eye(33,47,7,9,2),*eye(63,47,7,9,-2),b('M23 68Q26 55 47 63Q66 53 73 65Q76 82 50 85Q28 85 23 68Z',2.2),
 p('M39 61Q48 56 58 61L50 70Z'),s('M50 70V76Q58 81 64 72M50 76L40 77',2.2),p('M33 78L36 85L42 82Z'),*[c(x,y,1.3) for x,y in [(32,66),(37,70),(66,65),(64,70)]]
],[b('M9 17Q0 10 7 4Q14 0 18 12H30Q38-1 44 6Q49 13 39 18L46 25L42 37L26 46L9 40L2 29Z',3),p('M21 10H29L25 23Z M5 22L17 27L11 31L4 28Z M34 25L44 20L44 27L37 31Z'),c(16,25,2.5),c(34,25,2.5),b('M12 35Q17 28 25 33Q36 27 39 35Q34 46 23 43Z',2),p('M20 32H31L25 38Z')])

add('koala','🐨','Koala','Soft static','Animals',
'Huge ragged ears, a drooping pill-shaped nose, and a sleepy side glance. The soft exterior meets hard patches of black fur.',
'The ears and long black nose occupy most of the small master.',[
 b('M29 29Q26 9 11 12Q1 14 3 26Q-2 36 5 40Q0 51 16 56Q31 58 34 43Z'),b('M64 29Q68 9 83 13Q96 15 92 29Q99 40 90 45Q95 55 80 58Q65 57 62 42Z'),
 p('M22 26Q9 15 8 30Q3 42 20 47L27 36Z M74 27Q90 15 88 32Q95 44 77 49L71 36Z'),
 b('M23 35Q31 21 51 24Q78 25 80 52Q83 79 55 88Q24 87 18 66Q12 52 23 35Z'),
 *sleepy(31,49,7,9),*eye(68,49,6,8,-2),p('M42 44Q46 35 53 41Q61 52 58 66Q49 73 39 65Q37 57 42 44Z'),
 s('M47 77Q58 81 64 73M29 70L32 73M66 67L69 64',2),*hatch(41,28,4,3,6),s('M45 47L43 57',2,stroke=PAPER)
],[b('M15 11Q-1-4 1 19Q0 30 13 29L13 15M33 11Q49-4 47 19Q49 30 35 30Z',3),b('M10 20Q12 9 25 11Q41 10 40 27Q42 45 24 46Q7 45 8 29Z',3),c(15,25,2.5),c(34,25,2.5),e(25,29,6,10)])

add('frog','🐸','Frog','Pond punk','Animals',
'A gloriously wide frog with pop-up eye towers and an almost ridiculous crescent grin. Warty dots sit against one deep black mouth.',
'Two eye bumps and the wide mouth are kept oversized at 16px.',[
 b('M16 39Q4 15 24 10Q41 6 44 29Q52 22 57 30Q61 6 80 15Q94 22 81 42Q98 54 88 71Q77 88 46 86Q13 87 5 67Q0 51 16 39Z'),
 *eye(28,28,11,14,3),*eye(72,31,10,13,-3),p('M13 55Q50 70 86 52Q77 82 49 81Q24 81 13 55Z'),
 b('M33 74Q42 62 54 74Q64 67 70 73Q55 84 33 74Z',1.5),s('M14 48L22 50M80 46L85 44',2),
 *[c(x, y, 2) for x, y in [(14, 40), (10, 49), (88, 45), (85, 77), (20, 74)]], s('M24 64Q48 72 73 62', 1.7, stroke=PAPER)
],[b('M8 19Q0 4 12 3Q24 1 22 18H28Q27 2 39 4Q50 7 41 22Q52 29 43 39Q23 52 6 39Q-2 30 8 19Z',3),c(14,13,3),c(36,14,3),p('M8 28Q25 36 43 27Q33 47 19 40Q11 36 8 28Z')])

add('unicorn','🦄','Unicorn','Myth fit','Animals',
'A proud side-profile unicorn with a striped horn, swept ink mane, high collar-like jaw, and one half-lidded eye.',
'Profile, diagonal horn, and the deep mane do the work; stripe and eyelash detail is removed.',[
 p('M51 18Q78 17 84 39L75 47Q89 59 79 76L69 72Q76 85 61 91L38 88L41 59Z'),
 b('M44 28L35 5L53 22Z'),s('M39 13L47 15M42 19L51 22',1.4),
 b('M51 25L60 11L65 29Q74 36 68 53L57 66L54 84L28 85L29 71L14 67Q5 59 14 48L34 33L32 19Z'),
 p('M47 26Q60 22 65 28Q52 32 47 41L36 39Z'),*sleepy(46,46,8,9),c(20,58,2.5),s('M15 65Q26 68 31 60M42 68L36 81',2),
 s('M66 36Q77 46 64 60M64 66L62 79',2,stroke=PAPER),star(81,11,7),star(12,25,4),*hatch(30,73,3,3,6)
],[p('M28 9Q47 9 44 28L38 31L42 44H22L24 23Z'),b('M20 15L15 1L28 12L33 5L34 19L29 32L27 44H13L15 35L3 30L4 23L17 16Z',3),p('M23 14L35 12L29 22H20Z'),c(23,24,2.8),c(8,28,1.8)])

add('bee','🐝','Bee','Buzz cut','Animals',
'A striped bean of a bee, buzzing on mismatched wings with a sharp sting and little hooked feet. Oversized eyes lean into its flying direction.',
'Two broad wing lobes, two body bands, and one eye replace the wing veins and feet.',[
 b('M39 39C10 44 7 8 24 8Q41 7 45 34C45 2 71 4 68 23Q66 39 51 43Z'),s('M25 15Q20 30 40 36M59 17Q60 28 51 33',1.8),
 p('M24 66L5 72L21 78Z'),b('M21 43Q40 25 61 34Q86 38 85 57Q82 78 54 83Q25 88 17 66Q11 53 21 43Z'),
 p('M27 39L37 35Q25 59 43 84L32 81Q17 59 27 39Z M46 34L58 34Q45 63 62 81L50 84Q35 63 46 34Z'),
 *eye(66,47,8,11,3),*eye(81,47,7,10,2),s('M65 70Q75 71 78 64M72 32L72 22L66 18M82 34L90 24',2.5),c(66,18,3),c(90,24,3),s('M43 83L42 91L49 91M62 81L64 89L70 86',2),
 s('M10 31L3 28M10 40H3',2)
],[b('M20 19Q0 12 10 3Q22-1 25 15Q28-4 39 5Q46 14 31 21Z',2.7),b('M7 21Q27 10 41 23Q53 37 27 43Q5 47 4 32Z',3),p('M13 20L20 17L18 42H11Z M25 18L31 19L28 42H22Z M5 32L0 39L8 38Z'),o(38,27,5,6,2),c(40,28,2)])

add('whale','🐳','Spouting whale','Big splash','Animals',
'A smiling whale throws a three-way fountain while its raised flukes curl over the body. Long belly grooves and a little fin give the big shape movement.',
'A blunt head, raised tail, and three thick fountain strokes remain.',[
 b('M18 43Q34 24 56 41Q76 57 74 32L60 25Q57 13 60 9Q75 11 80 24Q83 10 95 14Q98 30 83 35Q96 64 69 78Q43 96 16 76Q0 63 18 43Z'),
 p('M13 65Q43 83 79 55Q83 73 59 81Q26 87 13 65Z'),b('M41 61Q39 78 52 82Q66 78 56 60Z',2.4),
 *eye(27,49,7,10,2),s('M13 60Q27 70 37 58',2.3),s('M21 73Q30 80 40 80M59 72L63 79M65 67L71 74',1.5,stroke=PAPER),
 s('M36 35V18Q30 8 23 19M37 23Q43 5 49 17M36 15Q35 2 29 5',3),c(20,27,2),c(50,24,2),*hatch(48,43,3,3,6)
],[b('M6 24Q15 15 28 24Q41 31 39 16L30 11L31 3L40 8L46 3L48 13L43 20Q51 37 33 43Q10 53 3 37Z',3),c(13,29,3),s('M8 38Q22 45 35 34',2.5),s('M19 17V5M19 10L12 6M19 10L25 5',3)])

add('butterfly','🦋','Butterfly','Wing thing','Animals',
'An uneven pair of wings mixes big black tips, paper teardrops, and eyespot-like ovals. The tiny body sports high antennae and a cocked head.',
'Four clearly separated wing lobes and two large paper spots replace the fine wing pattern.',[
 b('M43 39C7-7-5 28 13 53C-3 73 23 97 44 66L51 67C75 99 98 74 81 51C105 13 65 3 52 40Z'),
 p('M41 37C9 0 2 27 14 49L34 51Z M56 38C78 3 98 24 80 46L61 49Z M21 60Q5 83 31 77L42 63Z M61 60L58 70Q86 90 80 63Z'),
 b('M16 22Q31 22 36 42Q18 40 16 22Z',2),b('M78 21Q61 29 61 42Q80 37 78 21Z',2),
 o(27,67,7,8,2),o(71,68,7,8,2),p('M44 37Q47 30 52 36L55 65L49 78L43 65Z'),o(48,33,6,7,2),
 s('M46 27L38 15M50 27L57 16',2),c(38,15,3),c(57,16,3),s('M45 49H53M45 56H54M46 63H53',1.4,stroke=PAPER)
],[b('M22 20C4-4-5 12 5 26C-4 40 10 52 22 33H26C37 52 54 37 42 26C57 2 35 0 26 20Z',3),p('M7 10Q17 11 19 25L9 22Z M39 10L32 23L28 25Q30 14 39 10Z'),e(24,28,3,14),s('M22 16L18 9M26 16L31 9',2.5)])

add('bear','🐻','Bear','Bear witness','Animals',
'A broad, inky bear with small round ears, a protruding paper muzzle, and one eyebrow raised. Short fur incisions keep the black mass lively.',
'The dark head and large white muzzle distinguish it from the light panda.',[
 b('M21 34Q3 26 13 12Q27 4 35 23Q49 17 61 23Q71 5 84 15Q94 28 78 36Q91 53 79 74Q53 97 25 79Q5 62 21 34Z'),
 p('M21 34Q3 26 13 12Q27 4 35 23Q49 17 61 23Q71 5 84 15Q94 28 78 36Q91 53 79 74Q53 97 25 79Q5 62 21 34Z'),
 o(34,46,8,10,2),o(64,44,7,9,2),e(36,48,3,5),e(62,46,3,5),
 b('M27 64Q25 53 46 56Q71 51 74 65Q76 82 49 85Q25 82 27 64Z',2.6),p('M37 56Q48 52 60 58Q56 69 48 68Q38 66 37 56Z'),
 s('M48 68V75Q38 79 34 71M48 75Q59 82 66 73',2.4),s('M27 31L39 28M61 30L70 35M23 57L19 64M72 67L76 62',1.7,stroke=PAPER),c(20,21,5,fill=PAPER),c(77,23,4,fill=PAPER)
],[c(10,10,8),c(38,10,8),p('M10 16Q9 7 25 9Q40 7 40 22Q50 44 26 47Q2 45 5 27Z'),e(16,24,3,4,fill=PAPER),e(34,24,3,4,fill=PAPER),e(25,36,12,8,fill=PAPER),p('M20 31H30L25 37Z'),s('M25 36V41',2)])

add('rabbit','🐰','Rabbit','Long wave','Animals',
'A rabbit whose mismatched ears act like bent aerials. An oversized tooth, diagonal whiskers, and a cheeky side-eye make it feel drawn in ink.',
'Tall ears, round cheeks, and a single big tooth stay distinct from the small-eared animals.',[
 b('M28 45Q7 9 20 4Q34 0 39 38L45 37Q50-2 69 5Q76 11 58 42Q83 49 81 71Q79 88 49 91Q17 88 14 70Q13 53 28 45Z'),
 p('M22 12Q20 21 32 40L35 37Z M65 12Q56 15 51 38L55 40Z'),
 *eye(36,57,9,12,3),*sleepy(61,55,8,11),p('M41 69L56 67L50 75Z'),s('M49 75L48 81Q37 83 34 74M49 80L60 78',2.2),
 b('M44 81L57 79L56 91L45 92Z',2),s('M50 81V89M24 69L6 65M25 74L8 79M70 67L88 62M71 73L90 77',1.8),*hatch(26,79,3,3,5)
],[b('M14 24Q2 3 10 1Q18-1 19 21H25Q29-2 37 2Q44 4 32 24Q46 29 43 39Q39 48 24 47Q6 48 4 35Q4 27 14 24Z',3),p('M10 5L17 21L14 22Z M35 6L29 22L27 21Z'),c(16,31,2.5),c(32,31,2.5),p('M20 36H28L24 41Z'),q(23,41,4,5)])

add('hedgehog','🦔','Hedgehog','Prickly print','Animals',
'A scruffy wedge of spines gives way to a long pointed nose and tiny planted feet. Three ranks of cut-paper quills make the back feel wonderfully overbuilt.',
'Five big spines and a long snout replace the layered quill texture.',[
 p('M20 68L17 82L30 84L34 70Z M64 68L62 82L76 81L75 69Z'),
 b('M7 63L5 44L13 45L10 28L22 33L24 12L37 23L45 5L55 20L70 10L73 31L84 39L82 51L94 60Q93 67 79 69L70 76L28 76Z'),
 p('M7 62L5 44L13 45L10 28L22 33L24 12L37 23L45 5L55 20L70 10L73 31L64 47L52 40L48 57L36 49L31 68Z'),
 s('M21 42L26 49L26 34M37 33L43 39L45 24M47 53L52 47M57 30L61 35',2,stroke=PAPER),
 *eye(70,50,7,9,2),c(90,60,5),s('M69 67L80 65',2),*hatch(39,65,3,3,7)
],[p('M10 34L9 43H18L20 35M31 35L33 43H41L37 34Z'),b('M3 30L1 18L9 19L9 7L18 13L23 2L30 12L38 7L39 21L47 30L40 35H16Z',3),p('M3 28L1 18L9 19L9 7L18 13L23 2L30 12L38 7L35 24L26 22L20 34Z'),c(37,26,2.4),c(45,31,2.5)])

add('parrot','🦜','Parrot','Talk shop','Animals',
'A crested parrot perches in profile, with a giant hooked beak, a graphic cheek patch, and an extravagant striped tail.',
'The hook of the beak and long diagonal tail are the main reading cues.',[
 s('M14 76L79 70',4),p('M41 67L53 93L61 87L52 61Z M50 65L64 91L70 83L59 59Z'),
 b('M33 36Q18 13 33 7Q29 19 43 17Q46 5 56 4L55 16Q69 12 77 23Q86 34 69 45Q71 70 51 76Q32 78 25 59Q21 45 33 36Z'),
 p('M31 40Q49 32 56 49L58 64Q49 75 38 70Q22 56 31 40Z'),s('M33 47L48 60M34 55L43 65',2,stroke=PAPER),
 o(61,29,12,15,2.7),*eye(61,28,6,9,2),b('M73 24Q93 21 92 42L82 52Q87 32 72 38Z',2.7),p('M76 28Q88 24 91 34L81 33Z'),
 s('M41 73L39 81M46 73L44 81M54 72L55 79',2.8),*hatch(36,27,3,3,7)
],[p('M21 32L29 48L38 45L28 29Z'),b('M17 16L13 6L23 9L27 2L31 9Q46 10 40 24Q44 37 29 40Q12 39 10 29Q8 20 17 16Z',3),p('M13 23Q24 18 29 28L28 36Q12 39 13 23Z'),b('M37 12Q50 11 46 27L42 32L42 21L35 20Z',2.5),c(31,18,2.8)])

add('ladybird','🐞','Lady beetle','Spot check','Animals',
'A tilted lady beetle becomes a glossy little print-shop stamp: broad black spots, one divided shell, six bent legs, and a tiny inquisitive head.',
'Four enlarged dots and a central shell seam replace the smaller markings.',[
 s('M26 40L12 34L6 40M21 57L8 58L5 65M29 75L16 83L17 90M68 34L84 28L90 34M77 51L90 52L93 61M70 71L85 77L84 86',3.5),
 p('M32 27Q29 12 43 8Q62 2 69 20L65 35Z'),s('M41 12L34 4M59 9L67 2',2.5),
 b('M32 24Q66 11 76 41Q91 76 54 88Q22 94 18 62Q13 36 32 24Z',3.5),
 s('M46 23Q40 54 55 88',3),c(29,44,8),c(32,68,7),c(63,38,6),c(66,62,9),
 c(43,17,3,fill=PAPER),c(57,14,3,fill=PAPER),s('M21 54L20 61M61 79L67 74',1.5)
],[s('M9 20L2 16M7 29L1 30M13 39L6 46M37 19L46 14M41 28L48 30M36 39L43 46',3),p('M14 13Q10 1 24 1Q37 0 36 13Z'),b('M16 9Q37 4 42 24Q47 43 26 46Q5 44 5 27Q5 14 16 9Z',3),s('M23 10L26 44',2.5),c(14,23,4),c(16,36,4),c(33,21,4),c(35,33,4)])

add('flamingo','🦩','Flamingo','Leg room','Animals',
'A long S-neck flamingo balances on one leg, with a drooping two-tone beak and a folded wing shaped like a brushstroke.',
'The hooked neck, long planted leg, and folded knee retain the unmistakable silhouette.',[
 s('M42 60L40 87L30 90M51 60L65 74L48 79',3.5),
 b('M14 45Q29 30 49 39Q64 44 60 53Q73 47 64 33Q49 12 65 6Q83-1 87 14Q88 25 76 27Q72 26 72 20Q77 17 75 13Q67 9 67 17Q90 38 77 52Q68 62 52 61Q33 75 13 55L5 57Z'),
 p('M15 47Q40 36 53 49Q43 65 22 58L30 52Z'),s('M25 46L45 48M27 55L42 53',1.6,stroke=PAPER),
 b('M79 18L92 24L88 40L78 34L73 24Z',2.5),p('M83 26L91 28L88 40L80 35Z'),c(79,13,2.5),s('M42 65L40 82',1.3),star(11,22,4)
],[s('M20 31V46H14M26 31L34 38L23 41',3),b('M3 25Q11 17 26 22Q35 25 32 17Q23 5 32 2Q43-2 44 8L39 14L43 18L46 12L46 22L38 21Q36 33 22 33Q5 37 3 25Z',2.7),p('M5 25Q15 21 25 26L15 31Z'),c(38,7,1.7)])

add('dolphin','🐬','Dolphin','Wave rider','Animals',
'A dolphin curls into a leaping comma. Its long beak, swept dorsal fin, underbelly, and split flukes remain clear inside a bold black silhouette.',
'The small drawing exaggerates beak, dorsal fin, and forked tail.',[
 b('M13 35Q20 22 38 21L57 7L58 25Q83 33 79 63L91 65L95 82L79 77L68 90L60 77L68 66Q69 49 53 47L51 62L40 52Q26 56 18 47L4 48L7 41L20 39Z'),
 p('M14 34Q33 23 57 26Q81 34 76 62L69 65Q66 40 41 41L19 42L5 47L7 41L20 39Z'),
 *eye(31,35,5,7,1),s('M14 47Q28 51 35 43',2),s('M53 30Q67 34 70 41',1.5,stroke=PAPER),
 s('M15 65L9 70M28 73L22 81',2),star(83,18,5),*hatch(42,44,3,3,6)
],[b('M3 16Q10 9 21 11L30 2L31 14Q46 21 39 35L46 39L46 46L37 42L28 48L25 41L32 36Q36 23 24 23L24 31L16 26L4 25L0 21L8 19Z',3),p('M7 15Q29 8 38 25L35 31Q27 18 12 20L2 22Z'),c(13,16,2,fill=PAPER)])

add('trex','🦖','T. rex','Tiny arms club','Animals',
'A heavy-jawed dinosaur with a checkerboard grin, tiny reaching arms, a big belly, and an impatient tail. It is all attitude and mismatched proportions.',
'An oversized jaw, sawtooth mouth, short arm, and sweeping tail define the little master.',[
 p('M51 70L52 83L40 88L40 92L65 92L65 78Z M70 70L75 82L70 90L91 90L87 83L80 79Z'),
 b('M38 53L28 48L20 24Q13 9 37 7L76 8L90 18L88 39L61 44L67 52L80 57L78 63L63 62Q89 79 63 83Q38 85 22 68L4 51Q24 68 38 66Z'),
 p('M21 26L89 23L88 39L32 42Z'),s('M28 27L33 35L40 27L47 34L54 26L61 33L68 25L76 32L84 25',2.2,stroke=PAPER),
 *sleepy(63,18,9,8),c(81,17,2),s('M49 51L58 57L52 63L46 59M34 52L41 58',3),
 s('M47 71Q56 77 69 72',2),*hatch(26,15,3,3,6),p('M26 46L23 51L31 53Z M32 59L31 64L39 64Z')
],[p('M23 34L20 44H33L32 34M33 36L37 45H47L44 40Z'),b('M19 26L10 16L8 5L37 3L46 9V21L28 24L30 28L39 31L37 35L29 33Q44 44 27 43Q9 41 1 29L17 34Z',3),p('M12 14H44V20H15Z'),s('M17 14L21 18L25 14L29 18L34 14L38 18',1.5,stroke=PAPER),c(32,9,2.8)])

add('wolf','🐺','Wolf','Moon caller','Animals',
'A narrow, upward-tilted wolf head with tall black ears, a long muzzle, and stepped neck fur. The profile separates it from the front-facing fox.',
'A tall ear and rising snout stay angular; the neck ends in three large fur points.',[
 b('M20 45L14 8L36 26L50 18L74 11L84 15L83 24L69 35L62 48L73 52L65 61L69 66L58 74L54 91L42 85L32 92L30 80L17 76L20 64L9 61Z'),
 p('M14 8L36 26L28 38L22 30Z M50 18L73 11L75 20L61 31L51 36L40 32Z M22 54L37 61L32 79L21 74L23 63L13 60Z'),
 b('M39 38L63 31L65 38L54 46L44 47Z',2),e(52,38,3,5),p('M76 11L87 11L90 17L83 24L74 20Z'),
 s('M65 35L79 30M45 49L54 51M35 73L39 78',2),*hatch(42,58,4,3,8),star(84,75,5)
],[b('M10 24L5 2L20 13L26 10L42 5L47 10L39 20L32 25L37 29L30 34L28 46L21 41L15 46L12 37L4 33Z',3),p('M6 4L20 14L14 24Z M25 11L41 5L43 12L29 21L21 17Z M41 5L47 7L46 13L40 14Z'),p('M19 22L30 18L28 23L22 26Z'),s('M32 25L41 21',2.2)])

add('raccoon','🦝','Raccoon','Night bandit','Animals',
'A ragged, wide raccoon face peers through one sweeping black mask. Little pointed ears, white brows, and a dark chin make a very different character from the panda.',
'A continuous eye mask and white pointed muzzle carry the small version.',[
 b('M16 37Q10 20 14 10L36 26Q50 21 62 27L84 14L81 41L92 48L85 53L91 61L80 66L76 77L57 86L40 89L21 79L15 69L4 64L10 54L3 49Z'),
 p('M17 16L31 28L21 35Z M78 20L66 30L77 37Z M10 43Q33 35 47 48Q59 32 86 44L83 64Q58 67 48 57Q30 75 11 60Z'),
 *eye(30,51,7,10,2),*eye(66,50,8,10,-2),b('M32 70L45 55L53 56L66 69Q59 84 48 83Q36 82 32 70Z',2.2),
 p('M39 64Q48 58 58 64L50 73Z'),s('M50 73L49 79L42 79',2),p('M37 84L59 84L49 91Z'),*hatch(43,30,3,3,7)
],[b('M8 20L6 4L17 12L29 11L42 5L40 23L47 27L41 38L26 47L11 41L1 31Z',3),p('M6 22Q15 16 24 24Q36 15 43 23L42 32L31 34L24 28L16 35L5 32Z'),e(15,26,2.5,3,fill=PAPER),e(34,26,2.5,3,fill=PAPER),b('M18 36L24 29L31 36L25 43Z',1.7),p('M20 34H29L25 39Z')])

add('otter','🦦','Otter','Pocket pebble','Animals',
'A floating otter holds a little stone on its chest, with its feet tilted toward the viewer and its heavy tail curled underneath. A soft muzzle and whiskers keep it otter-like.',
'The reclined body, two feet, and held pebble remain; water and whisker lines are omitted.',[
 b('M64 56Q89 67 86 81Q86 95 58 90L39 81Q62 85 65 75Z'),p('M69 74Q80 83 60 88L40 82L49 89L68 93L82 87Z'),
 b('M28 35Q12 25 23 17Q28 14 33 21Q49 10 59 19Q64 10 72 18L69 29Q80 47 68 73Q48 92 30 70Q18 59 28 35Z'),
 b('M33 34Q41 25 49 32Q61 26 65 39Q62 51 47 50Q32 46 33 34Z',2),c(41,29,3),c(59,28,3),p('M43 34H55L50 41Z'),s('M49 41L53 45M32 39L21 37M34 43L23 46M62 39L75 37',1.7),
 o(48,63,16,17,2),b('M44 51L54 49L62 58L56 70L44 72L38 62Z',2.5),s('M29 51Q29 65 43 62M68 51Q69 62 59 61',5),
 o(30,76,9,7,2.5),o(62,79,9,7,2.5),s('M27 75L30 80M32 74L35 79M59 78L62 83M64 77L67 82',1.5),s('M9 65L18 66M10 73H18',2)
],[b('M31 29Q48 39  40 45Q26 51 19 41Z',3),b('M11 15Q3 8 10 4L17 8Q26 1 31 9Q39 4 40 12L35 18Q44 39 26 44Q7 42 9 25Z',3),c(17,17,2),c(29,16,2),p('M19 20H28L24 25Z'),o(25,32,7,8,2.3),s('M11 29L20 32M35 28L29 32',3),e(13,40,6,4),e(31,43,6,4)])

add('snail','🐌','Snail','Slow roll','Animals',
'A low-slung snail drags a huge spiral shell, with two stalked eyes, a folded underside, and a smiling shovel-shaped face.',
'A large spiral and two high eye stalks survive without the shell hatching.',[
 b('M17 70Q6 66 6 49Q4 21 30 16Q63 9 67 42Q72 65 47 74Z'),
 p('M16 62Q7 48 16 30Q32 12 50 25Q70 39 54 56Q41 68 29 54Q20 42 31 34Q40 27 46 37Q52 46 40 49L37 44Q45 45 42 38Q34 32 30 41Q25 52 38 57Q55 60 57 45Q55 23 35 23Q12 24 14 46Q15 59 26 67Z'),
 b('M11 73Q31 68 57 73L68 63L67 42L75 40L79 58L81 42L89 43L89 67Q96 75 87 80Q68 91 31 87L5 80Z'),
 o(70,36,7,9,2.5),o(87,36,7,9,2.5),e(71,38,3,5),e(86,38,3,5),s('M76 71Q84 75 89 67M18 81L53 82',2),*hatch(44,18,4,3,5)
],[b('M7 33Q-1 22 7 10Q18-2 31 11Q42 26 28 36Z',3),s('M12 28Q3 16 15 11Q30 7 30 23Q29 32 19 28Q13 22 18 19L23 21',3.3),b('M3 39L28 36L35 28L35 17H40L 40 33L43 18H47L46 38Q42 47 7 45Z',2.8),c(36,15,3),c(45,15,3)])

add('crab','🦀','Crab','Claw machine','Animals',
'A squat crab wears its giant claws like boxing gloves. Eight angular leg endings, stalked eyes, and a toothed grin give it a dense, comic silhouette.',
'Two huge open pincers and a low shell replace the finer limb articulation.',[
 s('M28 58L9 54L3 62M25 67L8 67L3 77M30 75L17 83L18 91M39 80L31 90M68 58L87 55L93 64M71 66L88 69L93 79M60 77L78 84L76 92M56 81L62 90', 3.5),
 b('M24 48L11 42Q-1 29 10 15L12 29L20 28L21 10Q39 24 31 39L30 49Z'),
 b('M65 49L66 39Q57 24 73 11L74 29L83 29L88 14Q101 34 85 44L73 52Z'),
 b('M25 46Q50 34 70 46L81 63Q76 85 47 84Q14 83 15 60Z'),
 s('M37 45L34 30M59 44L63 30', 4), o(33, 28, 7, 8, 2.5), o(64, 28, 7, 8, 2.5), c(35, 29, 3), c(62, 29, 3),
 p('M28 61Q49 69 68 59Q65 77 48 77Q32 76 28 61Z'),s('M38 66V71M48 68V73M58 66V71',2,stroke=PAPER),*hatch(38,48,4,3,6)
],[s('M11 29L2 27L0 32M11 35L2 36L1 42M16 40L10 47M36 29L46 27L48 33M37 36L47 37L48 43M32 41L37 47',3),b('M12 23Q0 21 2 8L7 13L11 11L12 2Q25 14 16 24Z',2.5),b('M32 24Q24 13 36 3L37 12L41 14L46 7Q50 23 37 25Z',2.5),b('M12 24Q25 16 38 25L42 33Q38 45 23 43Q6 43 6 32Z',3),s('M18 24L16 17M30 24L33 17',3),c(16,16,3),c(33,16,3),p('M16 32H34Q26 42 16 32Z')])

add('pufferfish','🐡','Blowfish','Puff piece','Animals',
'A puffed-up spiky globe with a tiny tail, enormous suspicious eyes, and a puckered mouth. Solid fins interrupt the sunburst outline.',
'Eight broad spikes, a side tail, and a ring-shaped mouth stay readable.',[
 b('M16 47L5 38L4 60L18 57L17 70L29 68L33 84L44 76L54 91L61 77L77 82L77 67L92 61L81 49L90 36L74 34L71 17L58 25L47 9L40 24L24 20L26 36L12 36Z'),
 p('M18 44L7 41L7 58L20 55Z'), *sleepy(48, 40, 10, 12), *eye(70, 43, 9, 11, -2),
 o(76, 62, 9, 7, 2.7), o(77, 62, 4, 3, 1.5), p('M41 61Q30 60 28 68L37 75L49 67Z'),
 *[c(x, y, 1.8) for x, y in [(29, 40), (29, 50), (39, 28), (55, 70), (60, 60), (48, 79), (70, 74)]], s('M32 65L39 68', 1.2, stroke=PAPER)
],[b('M9 19L3 12L1 32L10 30L12 40L20 36L27 46L31 37L41 39L40 30L48 25L41 19L44 9L34 11L28 2L23 10L12 7Z',3),o(25,20,6,7,2),c(26,21,2.5),o(38,26,6,5,2.5),p('M13 29L24 30L19 36Z')])

add('seal','🦭','Seal','Seal of approval','Animals',
'A whiskered seal props itself up on one paddle while its body flows into a split rear flipper. Long whiskers and a plump white belly keep the form gentle.',
'A round head joins a low body and double flipper; three muzzle marks replace the whiskers.',[
 b('M60 41Q44 24 57 12Q74-1 85 15Q99 34 79 46Q88 63 72 72L84 82L92 79L93 91L78 94L64 82Q30 89 10 70Q-2 54 15 45Q29 36 60 41Z'),
 p('M12 62Q28 82 64 74L77 91L64 84Q34 88 14 74Z'),*eye(66,24,6,8,1),*sleepy(83,25,6,8),
 b('M60 36Q68 28 76 34Q86 30 91 38Q84 48 74 46Q64 46 60 36Z', 2), p('M70 31L80 31L75 38Z'), s('M65 39L50 36M64 43L52 47M85 39L95 35', 1.6),
 b('M40 57Q45 76 30 84L20 83Q30 70 28 62Z', 2.5), s('M20 52Q28 46 42 48', 2), *hatch(49, 57, 3, 3, 7)
],[b('M29 22Q20 5 32 3Q45-1 46 12Q49 22 38 25Q47 35 36 38L43 45L48 41L46 47L38 46L31 42Q8 46 2 33Q-2 19 29 22Z',3),c(33,13,2),c(42,13,2),p('M34 18H42L38 22Z'),b('M17 29L23 31L17 43H10Z',2.3)])

add('chipmunk','🐿️','Chipmunk','Cache money','Animals',
'A striped chipmunk curls a huge comma tail around an acorn. Small ears, puffed cheeks, a white racing stripe, and a bent hind foot keep the subject specific.',
'The curling tail, cheek, and held nut remain; three back stripes reduce to one white slash.',[
 b('M42 64Q3 74 6 32Q8 3 32 5Q49 9 38 31Q25 43 24 26Q25 17 18 21Q9 50 40 48Z'),
 p('M42 59Q9 62 11 33Q13 9 29 11Q37 13 34 22L27 28Q25 17 18 21Q9 50 40 48Z'),
 b('M44 34L40 17Q43 10 49 16L55 27Q66 19 75 30L87 40L81 49L71 52Q80 71 60 82L39 80 Q20 67 44 34Z'),
 p('M45 38L52 40Q40 60 52 70 L45 74Q30 57 45 38Z'),
 *eye(68, 37, 6, 8, 2), c(85, 41, 3), s('M70 47L79 46', 2),
 b('M61 58Q72 51 80 59L77 70 Q69 80 63 70Z', 2.4), b('M59 58Q67 48 82 57L82 62L60 64Z', 2.2), s('M72 49L74 45M55 52L60 60 M79 52L77 59', 3),
 b('M43 70 Q50 70 54 82L70 85L70 90L40 90L34 81Z', 2.6), *hatch(64, 55, 4, 3, 5)
],[b('M19 32Q-1 40 1 18Q1 0 14 1Q29 4 19 17L12 14Q17 7 10 8Q3 22 20 22Z',3),b('M 20 20L21 8L27 15Q35 10 42 20L47 25L39 29Q44 44  30 47L16 43L13  30 Z',3),c(36,21,2.5),s('M25 27L21 39',3),o(36,36,6,7,2.5)])

add('sheep','🐑','Ewe','Wool power','Animals',
'A cloud of uneven wool sits on four ink-black sticks, with a dark drooping face and tiny pointed ears. Spiral curls add a little 1970s print texture.',
'A white scalloped body, dark head, and four strong feet replace the curls.',[
 p('M20 65L18 88H28L32 65Z M37 66L39 88H48L47 65Z M62 64L61 87H71L73 63Z M75 63L78 83L87 81L84 60Z'),
 b('M12 51Q0 39 13 30 Q6 16 24 17Q30 3 44 14Q58 1 66 15Q82 10 80 28Q98 30 87 47Q97 61 80 65Q76 81 61 72Q47 87 36 70 Q19 78 17 65Q0 65 12 51Z'),
 p('M60 30 L51 24L54 18L69 25Q80 17 87 27L95 22L94 34L89 38L88 60 Q78 74 66 59Z'),
 *eye(74,38,5,8,1),*eye(86,37,4,7,-1),s('M77 58L84 57',1.5,stroke=PAPER),
 s('M24 31Q17 25 25 22Q35 22 31 34M42 26Q38 17 47 18Q54 21 47 29M24 53Q16 45 25 41Q36 44 29 53M45 56Q38 46 47 44Q58 44 52 55M36 68Q33 61 40 60', 2)
],[p('M8 31L7 47H13L17  30 M21 33V47H27L28 31M33 30L35 45H42L39 29Z'),b('M4 25Q-2 17 6 14Q1 4 12 6Q18-2 24 5Q35-2 38 8Q49 6 45 18Q51 27 41 31Q39 42 29 36Q20 43 15 35Q2 39 4 25Z',3),p('M30 13L25 8L25 17L30 21L31 31Q40 38 43 27L43 17L47 10L39 13Z'),c(36,21,2,fill=PAPER)])

add('elephant','🐘','Elephant','Heavy thinker','Animals',
'A broad-eared elephant in three-quarter view with a curled trunk, two tiny tusks, and comic forehead wrinkles. The trunk doubles back like a loose cable.',
'The giant ears and looping trunk take priority over tusks and creases.',[
 b('M34 29Q21 6 8 19Q-5 40 13 66L36 64Z'),b('M64 28Q86 7 93 24Q99 47 80 67L64 64Z'),
 p('M15 24Q3 42 18 56L27 49L25 29Z M83 24L74 30 L76 50 Q90 47 83 24Z'),
 b('M25 29Q29 8 51 12Q76 12 75 38L72 59L59 70 L58 82Q67 91 73 79L77 73L84 76Q83 98 63 95Q43 94 43 76L41 67L27 60Z'),
 *sleepy(35, 44, 7, 9), *eye(64, 43, 6, 9, -1), b('M30 59L20 71Q35 75 39 60 Z', 2), b('M63 57L74 69Q60 71 59 60 Z', 2),
 s('M42 24Q51 20 60 24M43 31Q52 28 60 31M47 70H57M48 78L57 77M50 86L59 83',1.8),*hatch(35,14,3,3,5)
],[b('M17 15Q2-1 1 18Q-1 32 15 32L18 17M31 15Q48-1 47 19Q49 32 34 34Z',3),b('M13 16Q13 6 25 6Q39 6 36 25L29 33V40Q33 45 39 37L44 40Q39 51 28 47Q20 45 20 34L13 28Z',3),c(18,23,2),c(31,22,2),s('M23 15H29',2)])

add('giraffe','🦒','Giraffe','Tall tale','Animals',
'A tall giraffe bust with little knobbed horns, wide leaf ears, a long slanted neck, and irregular ink patches. Its muzzle is intentionally oversized.',
'Knobbed horns, the long neck, and three large spots replace the fine spots and mane.',[
 p('M37 41L29 91L67 91L65 46Z'), b('M40 40 L34 91L60 91L58 45Z'),
 p('M39 60 L48 50 L52 61L44 70 Z M51 72L59 67L60 82L53 86Z M35 82L43 77L48 90L34 91Z'),
 b('M34 27Q18 14 12 23Q17 36 32 35L29 48Q41 64 65 58L73 42L66 28Q80 26 85 16Q69 12 61 25Z'),
 s('M40 24L37 10M55 24L59 9', 5), c(37, 8, 5), c(59, 7, 5), *eye(40, 34, 7, 9, 1), *eye(59, 32, 6, 8, -1),
 b('M29 45Q44 35 68 41L70 51Q60 65 36 57Z', 2.4), c(38, 47, 2.5), c(60, 46, 2.5), s('M39 55L57 56', 2), p('M30 70L25 76L31 83Z M32 50 L27 56L31 64Z')
],[p('M18 22L14 47H33L30 23Z'),b('M20 22L17 47H31L28 23Z',2.6),p('M21 32L27 29L30 36L24 39Z M17 43L24 40L25 47H17Z'),b('M16 12L4 7L6 16L14 18L12 25Q 20 34 37 25L36 16L45 10L34 10L29 14Z',3),s('M21 12L19 3M29 13L32 3',3),c(19,3,3),c(32,3,3),c(20,20,2),c(31,20,2),s('M20 27H28',2)])

add('zebra','🦓','Zebra','Off the stripes','Animals',
'A zebra with a stepped punk mane and a long, blunt muzzle. Broad wedges of black stripe bend around the face and long neck.',
'The small master retains three heavy stripes, the mane, and squared muzzle.',[
 p('M51 18L69 11L73 20L84 20 L79 31L89 36L80 45L86 54L74 62L81 72L69 78L70 91H40 L41 46Z'),
 b('M40 24L30 7L43 8L50 20 L61 7L68 11L61 29Q70 45 54 61L54 87L28 88L29 70 L19 65Q5 65 7 51L26 34L25 19Z'),
 p('M31 29L51 36L47 41L20 39Z M24 46L42 45L37 52L13 55Z M43 55L57 60 L53 67L36 63Z M32 70 L54 76L53 83L30 77Z M49 20 L61 26L56 32L43 26Z'),
 *eye(45, 40, 7, 9, 2), b('M11 52Q18 46 28 52L30 60 Q14 70 8 60 Z', 2), c(17, 56, 2.5), s('M17 65L26 62', 1.7), *hatch(35, 80, 3, 3, 5)
],[p('M27 9L36 6L37 14L43 14L38 23L43 29L36 35L38 47H22L20  20 Z'),b('M18 14L12 2L20 3L24 10L31 2L34 6L29 16L 30 25L26 33V47H13L15 34L5 32L1 24L12 17L12 10Z',3),p('M11 17L25 20L21 25L6 22Z M18 29L28 31L25 37L15 34Z M14 40L26 43V47L13 44Z'),c(24,19,2.5),c(7,27,2)])

add('camel','🐫','Two-hump camel','Double hump','Animals',
'A two-humped camel ambles on long bent legs. Its bored face, lumpy humps, and heavy underside make it feel like a character on an old travel decal.',
'Two separate hump peaks, a high neck, and four long feet are essential.',[
 s('M14 53L5 65L5 72', 3), p('M22 65L18 86L12 90L25 91L30 70 Z M37 66L43 85L38 91H52L49 65Z M60 65L61 86L55 91H68L72 64Z M77 60 L78 82L85 88L91 87L85 79L85 50 Z'),
 b('M14 57Q13 40 25 30 Q30 14 39 38Q50 5 59 38Q60 50 68 40 L72 19L65 14L68 7L76 13Q89 5 92 16L89 20 L95 24L93 31L82 31Q92 67 72 70 L30 70 Q14 70 14 57Z'),
 p('M18 59Q45 66 77 53L81 61L71 71L28 70 Z'), c(84, 18, 2.7), s('M85 28H92M27 38Q30 27 34 38M48 32Q51 21 55 30', 2), *hatch(38, 50, 4, 3, 7)
],[p('M9  30 L5 46H12L16 32M20 32L23 47H29L26 32M32 31L 30 46H37L39  30 M40 27L 40 43H46L44 26Z'),b('M4 29Q7 9 13 12L18 22Q23 1 28 16L 30 23L35 22L36 8L34 3L40 5L45 2L47 7L44 12L48 16H42Q49 36 32 36H13Q2 37 4 29Z',3),c(43,8,1.7),s('M10 29H31',2.5)])

add('sloth','🦥','Sloth','Hang time','Animals',
'A sloth hangs sideways from a crooked branch, with very long hook arms and two dark eye crescents. Its smile is a small interruption in an otherwise lazy pose.',
'The hanging hook, dark eye patches, and tucked body remain; three-claw detail disappears.',[
 s('M7 16L87 10M70 12L79 4', 5),
 b('M28 45L20 21Q14 5 25 5Q30 6 29 15L37 35L60 36L70 13Q71 3 77 6L79 14L74 40 Q83 61 64 81Q40 100 22 80Q6 64 28 45Z'),
 p('M27 76Q40 90 60 74Q76 61 70 43L76 41Q89 66 60 85Q37 101 22 80Z'),
 b('M27 40Q44 27 61 40 Q74 54 62 68Q40 83 20 66Q10 52 27 40Z', 2.7),
 p('M24 46Q34 36 41 47L34 62L18 60Z M48 46Q57 37 65 48L67 58L54 61Z'),
 *sleepy(31, 51, 6, 7), *sleepy(56, 50, 6, 7), p('M37 59Q44 55 50 59L45 65Z'), s('M30 66Q40 75 56 64', 2), s('M23 10L25 17M74 9L76 16', 1.4), *hatch(44, 79, 4, 3, 5)
],[s('M2 7L45 3',3.5),b('M12  20 L8 7L11 2L16 5L18 17H 30 L35 4L 40 3L 40 9L37  20 Q49 35 30 45Q11 53 5 36Q1 26 12  20 Z',3),b('M11 22Q24 14 34 24Q44 40  20  40 Q2 40 11 22Z',2.4),p('M11 25L20 24L18 31L9 32Z M26 24L34 25L36 31H28Z'),s('M17 34Q23 39 29 33',2.3)])

add('cactus','🌵','Cactus','Desert radio','Garden',
'A three-armed cactus in a striped nursery pot, with tiny ink thorns and low-lidded eyes. Its ribs feel like grooves in a vintage plastic toy.',
'Three rising arms and a trapezoid pot remain; ribs reduce to one incision.',[
 b('M34 64V43H20Q8 43 8 29V21Q8 11 17 12Q24 12 24 23V28H34V15Q34 3 46 3Q58 3 58 15V37H70 V24Q70 15 78 15Q88 15 86 28V43Q86 54 70 54H58V66Z'),
 s('M43 13V35M49 56V65M17 22V33H32M77 25V45H60', 2), *sleepy(41, 43, 7, 8), *sleepy(56, 42, 6, 8),
 b('M25 66L70 64L65 89L31 92Z'),p('M25 66L70 64L69 73L27 75Z'),s('M37 79L38 87M47 77V86M57 77L56 85',2.2),
 s('M35 17L29 14M58 22L64 18M9 31L3 32M84 40L91 43M35 59L29 60', 2), star(80, 75, 5)
],[b('M17 33V23H8Q1 23 2 15V10Q8 3 10 11V17H17V5Q24-3  30 5V22H38V11Q44 6 46 13V25Q46 31 31 29V34Z',3),b('M13 34H36L33 46H16Z',3),c(22,20,2),c(28,20,2),s('M20 39H29',2.5)])

add('mushroom','🍄','Mushroom','Cap culture','Garden',
'A low mushroom cap becomes a checker-spotted umbrella over a stout, eye-bearing stem. A dark gill band gives the cap a strong underside.',
'The umbrella silhouette, three large cap spots, and chunky stem carry the drawing.',[
 b('M38 50 L31 81Q29 92 50 93Q70 91 65 81L58 50Z'), p('M37 55L32 72L39 76L44 57Z M57 57L61 82L66 84L60 54Z'),
 *eye(44,73,7,10,2),*sleepy(59,72,6,9),
 b('M5 47Q16 10 40 7Q74 1 91 42Q97 55 71 60Q 30 69 7 58Q0 55 5 47Z', 3.5),
 p('M6 48Q45 61 91 43L92 53Q50 70 6 57Z'), s('M18 54L24 59M32 57L36 62M52 57V63M71 54L67 60M84 49L80 55', 1.4, stroke=PAPER),
 o(25, 34, 9, 6, 2), o(40, 17, 8, 5, 2), o(67, 27, 11, 8, 2), o(52, 43, 7, 4, 2), s('M44 86Q51 88 55 84', 1.7)
],[b('M18 25L13 43Q13 49  30 47Q36 46 33 40L29 25Z',3),b('M2 24Q9 1 25 1Q 40 0 47 25Q 40 35 8  30 Z',3),p('M4 25Q25 33 46 24L45 29Q25 38 5 30Z'),c(14,18,4),e( 30,12,5,4),c(24,39,2.5)])

add('sunflower','🌻','Sunflower','Sun dial','Garden',
'A heavy, seed-speckled face sits inside a ring of slightly wonky petals. The stalk bends under two bold leaves, like a mascot from a 1970s seed packet.',
'Eight blunt petals surround an ink disc; the two leaves stay broad.',[
 s('M47 64L44 92', 5), b('M45 82Q24 80 21 66Q41 64 45 82Z', 2.5), b('M46 75Q63 57 76 68Q68 84 46 83Z', 2.5), s('M29 71L40 78M56 75L66 70', 1.5),
 *[dict(tag='path',attrs={**b('M39 21Q35 3 46 1Q60-1 57 21L48 28Z',2.7)['attrs'],'transform':f'rotate({i*30} 48 38)'}) for i in range(12)],
 o(48,38,24,24,3.2),c(48,38,20),*eye(40,36,7,9,1),*sleepy(56,35,7,9),s('M39 49Q49 57 59 46',2,stroke=PAPER),
 *[c(x, y, 1.3, fill=PAPER) for x, y in [(34, 26), (46, 20), (57, 24), (66, 41), (32, 43), (40, 55), (58, 53)]]
],[s('M24 31V47',3),p('M24 44Q9 46 7 36Q21 33 24 44Z M25 42Q 30  30 43 34Q43 44 25 46Z'),b('M16 8Q12-3 23 3Q33-5 33 8Q47 3 41 16Q52 21 40 26Q46 40 33 33Q25 43  20 33Q7 41 10 28Q-4  20 9 16Q2 4 16 8Z',2.7),c(25,21,12),c(21,20,2.5,fill=PAPER),c(29,20,2.5,fill=PAPER),s('M21 27H28',2,stroke=PAPER)])

add('lemon','🍋','Lemon','Sour note','Food',
'A bumpy, sharply pointed lemon with a leafy quiff and a deeply unimpressed expression. Pith-like hatching gives the rind a printed texture.',
'Two pointed ends, one leaf, and one arched eye cut remain.',[
 b('M17 36L13 25L26 24Q49 7 73 25Q90 39 83 65L91 75L78 79Q53 98 27 77Q9 63 17 36Z'),
 b('M49 21Q38 4 64 2Q78 14 49 21Z',2.6),s('M49 20L66 8',1.8),
 *sleepy(40, 47, 10, 11), *sleepy(64, 48, 9, 10), p('M40 70 Q49 57 60 70 Q48 65 40 70 Z'),
 *hatch(27, 29, 4, 3, 7), *[c(x, y, 1.4) for x, y in [(24, 48), (25, 60), (34, 72), (67, 72), (76, 61), (61, 30)]], s('M33 79Q53 89 70 77', 1.5)
],[b('M8 17L4 12H13Q 20 5 34 14Q46 22 40 36L46 42L37 42Q 20 53 8 37Q2 29 8 17Z',3),b('M23 12Q15 1 34 1Q38 10 23 12Z',2.5),s('M15 24L22 23M28 24L35 26',3),s('M20 35Q25 31  30 35',2.5)])

add('watermelon','🍉','Watermelon','Seed side','Food',
'A slanted watermelon wedge wears heavy-rimmed sunglasses. Fat seed teardrops, a generous rind, and a chipped point make it a sticker with a strong triangular read.',
'The wedge and two thick rind arcs stay; sunglasses merge into one black band.',[
 b('M12 14L90 69Q58 108 14 70 Q-1 50 12 14Z', 3.5),
 p('M11 39Q25 89 83 65L90 69Q53 106 17 70 Q5 55 11 39Z'), s('M11 51Q30 89 80 75', 2.5, stroke=PAPER),
 p('M17 30 L38 36L33 52Q17 53 15 41Z M44 41L66 50L60 63Q40 60 40 49Z'), s('M34 42L44 46', 4),
 s('M22 36L27 40M47 48L52 52', 2, stroke=PAPER), p('M26 20Q35 29 29 30 Q23 30 26 20Z M21 57Q30 60 26 66Q20 68 21 57Z M43 65Q50 69 46 73Q40 73 43 65Z M72 59Q80 61 76 65Q70 66 72 59Z')
],[b('M6 3L47 31Q29 56 8 36Q-2 26 6 3Z',3),p('M4 23Q18 44 41 27L47 31Q 20 59 7 35Z'),s('M10 36Q25 48  40 36',2,stroke=PAPER),p('M11 14L 30 22L28 28L10 23Z'),p('M17 9L22 14L18 15Z M15 28L19 33L15 34Z')])

add('avocado','🥑','Avocado','Pit stop','Food',
'A pear-shaped avocado carries a giant pit with a little face inside. A thick rind, one leaf, and subtle off-centre contours make the image feel carved.',
'The pear silhouette and a large round pit stay; the pit face becomes two white dots.',[
 b('M30 29Q30 2 49 4Q67 4 69 31Q72 43 84 62Q95 89 50 94Q8 96 12 66Q14 47 30 29Z', 3.5),
 p('M30 29Q30 2 49 4Q67 4 69 31Q72 43 84 62Q95 89 50 94Q8 96 12 66Q14 47 30 29Z'),
 b('M37 30 Q36 12 50 12Q60 13 62 35L77 64Q86 86 49 87Q18 88 20 67Q22 49 37 30 Z', 2.2),
 o(49, 64, 22, 23, 2.8), p('M34 48Q54 30 69 56Q76 78 55 84Q35 85 29 68Q47 84 62 68Q68 53 55 44Q44 41 34 48Z'),
 *eye(43, 61, 6, 8, 1), *sleepy(57, 59, 6, 8), s('M41 70 Q49 77 57 70', 1.8), b('M50 7Q64-2 78 3Q73 16 55 14Z', 2), s('M58 10L70 5', 1.3)
],[p('M 15 17Q14 1 25 1Q35 1 35 18L45 32Q51 48 24 48Q-1 48 3 32Z'),b('M20 17Q19 7 25 7Q31 7 31 19L 40 32Q46 43 24 43Q7 43 9 32Z',2.3),c(25,32,10),c(22, 30,2,fill=PAPER),c(29,30,2,fill=PAPER)])

add('doughnut','🍩','Doughnut','Hole lotta love','Food',
'A hefty doughnut with loose dripping icing, crooked sprinkles, and a big central hole. An eye pair above the hole turns the whole ring into a startled face.',
'A big paper centre and broad icing drips replace the sprinkles.',[
 b('M10 49Q8 12 47 9Q89 6 90 49Q94 85 54 90Q12 93 10 49Z',3.5),
 p('M13 65Q31 89 63 77Q83 70 88 40 L90 57Q86 94 45 91Q20 88 13 65Z'),
 b('M12 41Q20 8 51 11Q83 11 89 39Q90 53 81 48Q76 42 72 56Q66 67 60 54Q54 48 49 61Q42 72 36 57Q30 50 25 60Q18 69 16 55Q5 56 12 41Z', 2.5),
 *eye(38, 30, 6, 8, 1), *eye(59, 29, 7, 9, -1),
 s('M22 30 L27 27M70 26L76 30M17 43L23 45M76 41L80 37M28 70 L32 74M67 71L70 65', 2.4),
 # The compound outline leaves a real hole in both the ink and paper backing.
 p('M40 43Q52 35 63 44Q72 60 54 64Q35 65 36 52Z', fill=PAPER, stroke=INK, strokeWidth=3),
 s('M21 74Q28 80 36 81',1.5)
],[b('M2 24Q0 2 25 2Q48 2 46 26Q47 48 24 47Q0 47 2 24Z',3),b('M3 18Q7 2 25 3Q43 3 46 20L38 19L 30 26L23 21L16 28L10 20L4 26Z',2),c(25,26,9,fill=PAPER,stroke=INK,strokeWidth=3),s('M11  12 L16 10M34 11L37 15',2.8)])

add('rocket','🚀','Rocket','Local launch','Objects',
'A riveted, checker-finned rocket tilts into flight. Its porthole becomes an eye, its exhaust a stack of ink-and-paper flames, and its panels feel like old toy metal.',
'The diagonal body, porthole, paired fins, and bold flame form the small version.',[
 b('M35 50 L14 51L5 69L27 67Z M47 62L40 84L57 91L61 70 Z'),
 b('M25 67Q40 34 85 8Q90 53 58 76Z', 3.5), p('M69 18L85 8L85 29Z'),
 p('M25 67L58 76L63 68L31 58Z'), o(60, 40, 13, 13, 2.7), *eye(61, 40, 7, 9, 1),
 s('M45 40 L49 36M70 55L74 51', 1.5),
 b('M26 76L19 93L32 87L34 95L45 78Z', 2.5), p('M29 79L25 88L37 80 Z'),
 *[q(12 + i * 4, 60 + j * 4, 4, 4) for i in range(3) for j in range(2) if (i + j) % 2 == 0], star(26, 18, 7), star(80, 80, 6), c(15, 30, 2)
],[b('M16 25L4 25L1 36L14 33M24  30 L21 44L 30 47L33 34Z',2.5),b('M11 32Q19 11 44 2Q46 27 29 39Z',3),p('M35 6L44 2L44 13Z M11 32L29 39L32 34L14 27Z'),o(30,21,7,7,2.5),c(31,21,3),p('M12 37L6 48L17 43L19 47L24  40 Z')])

add('balloon','🎈','Balloon','Air head','Objects',
'A single pear-shaped balloon with a defiant face, thick highlight, tied neck, and a long unruly string. The line has the spring of old cartoon motion.',
'The tied neck and kinked string remain; a pair of big eye cuts replaces the expression.',[
 s('M47 68C71 80 20 80 40 93', 2.5),
 b('M48 5Q82 4 82 30 Q85 53 53 68L56 74L40 75L43 68Q15 52 13 30 Q10 7 48 5Z', 3.5),
 p('M68 11Q89 35 61 59L53 68L56 74L41 75L43 68Q78 40 68 11Z'),
 *sleepy(36, 31, 9, 11), *eye(59, 30, 8, 11, -1), p('M39 49Q48 41 59 48Q52 56 41 54Z'),
 s('M20 26Q21 14 30 13', 3), s('M42 68L52 69', 2), star(80, 73, 5)
],[s('M25 35Q38 41 22 47',2.7),b('M24 1Q42 1  40 17Q38 27 28 33L30 38H20L22 33Q3 25 4 13Q5 1 24 1Z',3),p('M33 4Q43 22 27 31L25  30 Q36 16 33 4Z'),e(17,15,2.5,4),e(29,15,2.5,4),s('M19 24H26',2.5)])

add('planet','🪐','Ringed planet','Ring leader','Objects',
'A tilted ringed planet with a heavy orbit band, zonal ink stripes, sleepy eyes, and a few four-point stars. It feels like a decal from a fictional record shop.',
'A single clean orbital band crosses the disc; two planetary stripes remain.',[
 b('M24 60 Q-3 74 5 83Q16 98 70 59Q104 32 89 26L73 30 Z', 3),
 o(49, 45, 31, 32, 3.5), p('M24 27Q40 41 77 33L79 40 Q40 47 19 35Z M25 61Q50 73 73 58L67 71Q40 86 25 61Z'),
 *sleepy(38, 40, 8, 10), *eye(58, 39, 8, 10, -2), s('M40 56Q48 62 57 52', 2.3),
 b('M5 77Q17 89 60 59Q84 41 91 30 Q99 39 76 58Q29 96 8 89Q-2 85 5 77Z', 2.5),
 p('M10 85Q33 88 80 53Q40 92 13 90Z'), star(14, 15, 7), star(82, 80, 7), c(68, 8, 2), *hatch(43, 18, 3, 3, 6)
],[b('M11 29Q-7 38 5 43Q19 48 41 26Q54 12 42 13Z',2.7),o(25,23,17,17,3),p('M11 13Q23 24 41  17 L42 22Q21 27 9 20Z'),c(22,22,2.5),c( 30,22,2.5),b('M2 37Q11 45 39 21L46 14Q 50  20 38 31Q16  50 3 43Z',2.5)])

add('moon','🌙','Crescent moon','Late face','Objects',
'A long-nosed crescent moon nods off in profile, with a protruding nose, small grin, crater dots, and stars cut like printer ornaments.',
'A bold crescent with a face notch and one star remains.',[
 b('M70 8Q40-1 19 20 Q-4 46 16 70 Q39 100 76 80 Q50 78 48 65L56 60 L46 56Q50 48 40 44Q30 24 70 8Z', 3.5),
 p('M24 18Q3 50 31 70 Q48 84 76 80Q42 102 16 70Q-4 40 24 18Z'),
 s('M27 40 Q30 49 40 40 M31 43L27 48M38 44L37 49M40 65Q43 71 50 69', 2.5),
 o(20, 36, 4, 6, 1.5), o(29, 60, 3, 4, 1.4), star(79, 30, 9), star(66, 53, 4), c(89, 60, 2)
],[b('M37 2Q14-2 5 17Q-4 35 15 45Q28 52 40 41Q26 42 24 34L29 30L23 27Q17 11 37 2Z',3),p('M8 13Q1 38  20  40 Q 30 45 40 41Q22 54 7 41Q-2 29 8 13Z'),s('M13 24L21 25',2.5),star( 40,17,6)])

add('test-tube','🧪','Test tube','Strange brew','Objects',
'A tilted laboratory tube bubbles over with an eye-bearing potion. Measurement cuts, a thick glass lip, and blunt liquid bubbles make it a playful bit of bench equipment.',
'The diagonal glass tube, dark liquid fill, and one floating bubble remain.',[
 b('M50 14L70 25L41 80 Q32 100 17 88Q5 79 15 60 Z', 3.2),
 b('M49 9L76 23L71 32L44 18 Z', 3),
 p('M29 40 Q40 50 56 49L37 83Q30 93 20 85Q12 79 20 67Z'),
 *eye(30, 64, 6, 8, 1), *eye(43, 61, 5, 7, -1), s('M20 77Q25 84 34 77', 1.7, stroke=PAPER),
 s('M52 28L59 32M48 36L54 39M19 70 L22 64', 1.7), o(61, 8, 4, 4, 2), o(82, 8, 6, 6, 2.3), c(86, 40, 3), star(70, 70, 6)
],[b('M26 7L37 14L 20 44Q16 51 7 44Q1  40 7  30 Z',3),b('M25 4L41 13L38 18L22 9Z',2.5),p('M 15 24L29  20 L18 42Q13 48 8 41Z'),c( 15,34,2,fill=PAPER),c(38,3,3),c(45,23,2.5)])

assert len(faces)==48, len(faces)
