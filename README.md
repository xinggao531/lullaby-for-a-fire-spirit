# Lullaby for a Fire Spirit

<p align="center"><img src="docs/poster.jpg" width="480" alt="Poster for Lullaby for a Fire Spirit: Ayaka and Kokomi in their burst poses before the fire spirit Pyrrhos in his lava cave"></p>

**[Play it in your browser →](https://xinggao531.github.io/lullaby-for-a-fire-spirit/)**

A Genshin Impact–inspired boss fight in one HTML file. You lead a party of two against **Pyrrhos, the Scorched Sovereign**, a Pyro boss:

- **Ayaka**, Shirasagi Himegimi of the Kamisato Clan (Cryo): a melee sword fighter. Her slashes are physical and only land within reach of the boss (she steps in a little when close). Frostfan Gale (E, 12s cooldown) sends an icy gust from her fan into the boss and frost-infuses her sword for 6s, so slashes apply Cryo. Eternal Winter Waltz (Q, 16s cooldown, needs 60 energy) is 3s of blizzard around her that hits hard, blows away fireballs, and makes her sword 2.2x stronger with longer reach.
- **Kokomi**, Divine Priestess of Watatsumi Island (Hydro): a long-range support. Her attack is a stream of bubbles that drift to the boss from anywhere but hit lightly (well under half of Ayaka's damage). Tide Sprite (E, 12s cooldown) is a water koi that keeps attacking for 6s even after you switch out, also at low damage. Tidal Lullaby (Q) sends a tide rolling out from her to the cave walls: it hits the boss once, heals both characters 20% + 80 HP, and for the next 3s each of her attacks heals both a little more.

Character and boss art (in-battle sprites, Elemental Burst poses, the boss's normal / attack / burst / defence / downed states, and fireball, eruption, rock-burst and lava-pool effects) is embedded in `index.html` as WebP data. Open `index.html` in a browser to play. There is no build step.

## Story

Far beneath the islands lies Magma Hollow, where the fire spirit Pyrrhos agreed five centuries ago to sleep and keep the island's fire asleep with him. This summer the offerings stopped, the sea boiled, and the Scorched Sovereign woke behind a shield of living flame. Ayaka, with her blade and fan, and Kokomi, priestess of the tides, set out on a mission to put him back to sleep.

The cover opens with the key art, difficulty picker and a Begin button; scroll down for the prologue, a detailed guide to each heroine's skills, the rules (reactions, armour, the Aegis, switching) and a field guide to Pyrrhos's attacks.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Click / J (hold) | Attack. Ayaka: sword combo (3 slashes and a spin), must be in reach. Kokomi: long-range bubbles that drift to the boss, light damage |
| 1 / 2 | Switch to Ayaka / Kokomi (0.8s cooldown; a downed character can't be picked) |
| E | Elemental Skill (Ayaka): Frostfan Gale, an icy gust from her fan into the boss; her sword is frost-infused for 6s |
| E | Elemental Skill (Kokomi): Tide Sprite, a 6s water spirit that keeps firing while the other character is on the field |
| Q | Elemental Burst (Kokomi): Tidal Lullaby, a tide wave that hits once and heals both characters 20% + 80 HP; for 3s after, each of her attacks heals both by 1.5% + 5 |
| Q | Elemental Burst (Ayaka): Eternal Winter Waltz, 3s of strong ice wind over a wide area; sword damage x2.2 and damage taken -40% while it lasts |
| Space | Jump: while airborne, ground attacks (shockwaves, fire trails, eruptions, meteors, the charge) miss you |
| Shift (hold) | Run: 65% faster, drains stamina |
| C / Right-click | Dash with i-frames (uses stamina) |
| P / Esc, M | Pause, Mute |

The key legend stays on screen during the fight. Touch controls (joystick and buttons) show up on phones.

## Difficulty

Pick Easy, Normal or Hard on the cover (the choice is remembered in your browser).

| | Boss HP | Armour (plain hits) | Damage to you | Time between attacks | Projectiles | Aegis shield |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | 26,000 | none | 85% | 120% | a bit slower | 90% |
| Normal | 32,000 | blocks 20% | 120% | 90% | a bit faster | 115% |
| Hard | 38,000 | blocks 40% | 170% | 62% | faster, more | 150% |

Elemental reactions (Frozen, Melt, Vaporize) pierce half of his armour, and a frozen Pyrrhos takes 30% more damage, so higher difficulties reward combining the two characters. While his Aegis is up, every hit goes to the shield and his HP cannot drop.

## Music

The cover has its own calm theme in the Japanese In scale (koto arpeggios, a shakuhachi-style flute, a soft drone, quiet taiko and wind chimes); it starts on your first tap or key press, since browsers block sound until then. An original battle theme is played live with the Web Audio API (no audio files): taiko drums, a koto melody over a D-minor progression, a driving bass line and string pads at 132 BPM. In Phase II the drums double and a shakuhachi-style flute joins; the music goes muffled while Pyrrhos is frozen, dips under burst cut-ins and fades out when the fight ends. Every attack has its own sound effect: Ayaka's blade whoosh and steel clang, crystal cracks for frost hits, a howling blizzard; Kokomi's bubble bloops and pops, the koi's drips, a rolling surf for her tide and a harp-like heal; sizzles for Melt, steam for Vaporize; Pyrrhos's fireball whooshes, rolling rumble, eruptions, shockwave whoomp, whistling meteors, and a burning sizzle when he hits you. Sound controls sit at the top right of every screen: a **Mute** button (or press **M** any time) and a **Volume** panel with separate Music and Effects sliders. Your settings are remembered in your browser, and a limiter keeps the louder mix from distorting.

## Results screen

Winning shows Ayaka and Kokomi on a dawn-gold card with your rank; losing shows Pyrrhos wreathed in fire on an ember card, with how far you wore him down and a tip for the next attempt.

## Arena

The fight takes place in **Magma Hollow**, Pyrrhos's lava cave: a basalt platform with glowing fissures ringed by a lava lake with drifting highlights, popping bubbles and two lavafalls, under a ceiling of stalactites, with ash and embers in the air.

## Mechanics

- **Elements:** Cryo and Hydro hits attach their element to the boss (icon over his head).
- **Frozen:** Cryo on a Hydro-affected boss, or Hydro on a Cryo-affected boss, encases him in a block of ice for 3.2s; it cracks just before he breaks free and shatters when he does. He can't be frozen again for 4s after he thaws.
- **Vaporize:** Hydro on his Pyro flames deals 2× damage.
- **Party:** both characters' cooldowns tick while benched. Energy particles give 60% to the benched character. If the active character falls, the other one switches in.

- **Melt:** Pyrrhos is Pyro-affected when he attacks (unless Cryo or Hydro is already on him). Cryo hits then Melt for 1.5× damage.
- **Blazing Aegis:** below 55% HP (and again at 25%) he gains a shield. It counts hits, not damage: physical slashes are blocked, and every Cryo or Hydro hit takes off exactly one point (60 points at 55%, 45 at 25%, scaled by difficulty). Breaking it staggers him for 5.5s (he slumps, dazed, and takes full hits; this is not a Freeze, which only comes from the Cryo + Hydro reaction).
- **Boss animation:** Pyrrhos breathes while idle, winds up with a "!" cue, lunges into the attack pose for volleys and eruptions, curls into his rock-ball defence form to roll through his charge and while his Aegis is up, flares into his burst form for shockwaves, meteors and spirals, is encased in ice when Frozen, and slumps with dazed embers circling his head when his shield breaks (Staggered) or he's defeated.
- **Attacks:** fireball volleys, a telegraphed charge that leaves fire, eruptions, and shockwave rings you can dash through. Phase II adds a meteor rain and a bullet spiral.

## Also in this repo: Idea Catcher

[`idea-catcher/`](idea-catcher/) is a separate iPhone voice-notebook app (a Home Screen web app) that records ideas, timestamps them and sorts them into projects with Claude. See its [README](idea-catcher/README.md).
