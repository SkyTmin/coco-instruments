# Art bible: pets of the prison camp

Pets for «Каторга», drawn and animated entirely in code on the procedural-film engine (drawn
mode). Sections follow the skill's `templates/art-bible.md`; what changed for game sprites is
said in each section. Where this file and a pet module disagree, this file wins.

## 1. Frame

- Square 1080 × 1080 at 24 fps, origin top-left, y down. Every pixel value here assumes it.
- One pet per frame, side view, **facing right**. The ground line is **y = 880**, the pet's
  feet (or belly, lying down) stand on it, centred on **x = 540**.
- The pet fills 55–65 % of the frame height standing (helmet top near y = 300), so jumps,
  swipes and flying dirt stay inside the frame: nothing is drawn outside x 60–1020, y 60–1020.
- Export (`tools/sprites.cjs`) renders the same scenes with `FILM.transparent`: no paper, no
  stripes, no grain — the pet alone on alpha. Preview sheets keep the paper plate so the ink
  reads the way the house style intends.

## 2. Palettes

Flat colour, tone from hatching. House colours (`ink`, `inkSoft`, `paper`, stripes) are the
skill's palette 2.1. Each pet names its own colours in its module, by what they colour
(`fur`, `furDeep`, `skin`, `helmet` …) — never by hue.

## 3. Line (at 1080 wide)

The pet is shown in the game at 44–200 px, 5–25 times smaller than drawn, so lines are heavier
than the film's (hero outline 5 px there):

| Element | Width | Colour |
|---|---|---|
| Silhouette outline | 11 px | ink 100 % |
| Part outline (paw, helmet, strap) | 7 px | ink 100 % |
| Detail (claw split, seams, mouth) | 4 px | inkSoft 90 % |
| Hatch strokes | 3 px | ink or the part's deep colour, 55–80 % |

Every line is `lib.inkPath` with pressure variation; a line that must stay put (a seam that
crosses a moving part) still boils.

## 4. Tone

- Light from the upper left; shadow on the lower right of every form, hatched at 45°
  (spacing 16 light, 11 mid, 8 dark), cross layer for the deepest shade only.
- Fur: short flicks along the silhouette on the back and crown, sparse stipple inside.
  No gradients. Glass (the helmet lamp) is the one place a soft glow is allowed.

## 5. Motion

- **On twos**: every pose is a function of the drawing index `d = floor(t · 12)`; 12 drawings a
  second, each held two frames.
- **Loops close**: an animation of N drawings is periodic in `d`, and so is the line boil —
  the boil index is `d mod P` with P dividing N, so the sprite loop has no seam.
- Contact and passing positions are exaggerated so the motion reads at 44 px: stride, bob and
  squash are larger than life.
- Snappy, never floaty: nothing eases over more than 4 drawings except sleep breathing.

## 6. Animations (every pet)

| Id | Drawings | fps | What reads |
|---|---|---|---|
| idle | 12 | 6 | breathing, one blink, one small signature twitch |
| walk | 8 | 12 | two steps, feet alternate, body bobs lowest on contact |
| happy | 8 | 12 | crouch, jump, eyes shut in a smile, land (plays once on a pat) |
| work | 8 | 8 | the role's trick as a little story (plays once when the game's trick fires) |
| attack | 6 | 12 | wind-up, lunge, the kit's hit effect, recover |
| sleep | 12 | 6 | lying down, slow breathing, rising Z's |

Loops close on themselves: boil is `d % period`, so the last drawing leads into the first.

## 7. Determinism

Seeds from `lib.hash(petId, part, …)`; no `Math.random`, no clocks. A drawing depends on
`(anim, d)` only.

## 10. Subject reference: the mole (Кротёнок-подкопщик)

- Chibi mole standing on its hind feet: pear body, no visible neck, a pointed snout ending in
  a pink nose; tiny bead eye just above the snout base.
- Mole forepaws are the character: broad, pink, palms turned outward, five long ivory claws,
  held in front of the chest like a digger's shovels.
- Hind feet small, pink, five short claws; tail a short pink stub.
- Kit: a dented yellow miner's helmet with a brass lamp, a leather belt with a buckle and a
  side pouch — a worker of the camp, not a toy.
- Mistakes to avoid: a neck (moles have none — the head flows into the body); round
  mouse ears (no ears show); black fur (read as a hole at 44 px — it is warm slate); paws like
  hands with fingers (they are spades with claws).
