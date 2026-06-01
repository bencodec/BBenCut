# BBenCut

An Ableton Live extension that applies [BBCut](https://composerprogrammer.com/research/bbcut2.pdf) breakbeat cutting algorithms to AudioClips in the Arrangement View.

BBCut is a SuperCollider library by Nick Collins that algorithmically rearranges audio loops using phrase-based cut procedures. This extension ports those algorithms to TypeScript and integrates them directly into Live as a context menu action.

<img width="403" height="454" alt="image" src="https://github.com/user-attachments/assets/91cac3e0-e72a-4c48-9a77-de0cc41f246d" />


## Usage

1. Right-click any AudioClip in the Arrangement View
2. Select **BBenCut → Rearrange**
3. Configure the total length, loop length, cut procedure and parameters
4. Click **Apply**

The original clip is replaced with a sequence of new clips arranged according to the chosen algorithm. Undo (Cmd+Z / Ctrl+Z) restores the original.

## How it works

The extension treats the clip's loop region as a **phrase** — one iteration of the source material. The selected cut procedure divides each phrase into blocks, and each block into cuts. Repeats within a block create a repeats effect; odd-length blocks at non-uniform offsets create rhythmic rearrangements.

Each cut becomes a new looping AudioClip in the arrangement, referencing the original audio file with adjusted loop markers. No audio is destructively modified.

**Very short cuts** (< 0.25 beats, the SDK minimum clip duration) are pre-rendered to a temporary WAV file before being placed as clips. This is primarily used by WarpCutProc1's geometric acceleration rolls.

## Cut Procedures

### BBCutProc11 (Classic)

The original BBCut algorithm. Produces blocks of repeated cuts at subdivisions of the phrase, with optional repeats sections near the phrase end.

| Parameter      | Default | Description                                 |
| -------------- | ------- | ------------------------------------------- |
| Subdivisions   | 8       | Number of equal divisions per bar           |
| Repeats chance | 0.2     | Probability of a repeats block              |
| Repeats speed  | 2       | Speed multiplier for repeats cuts           |
| Repeats area   | 0.5     | Fraction of phrase end where repeatss occur |
| Num repeats    | 1–2     | Random range for cut repetitions per block  |

### ChooseCutProc

Chooses block sizes from a weighted set, with optional roll (rapid repeat) sections.

| Parameter    | Default   | Description                               |
| ------------ | --------- | ----------------------------------------- |
| Roll chance  | 0.1       | Probability of a roll block               |
| Roll allowed | 2.0 beats | Maximum block size that can become a roll |

### ChooseBlockProc

Selects block sizes from a default weighted distribution. No user parameters — uses internal probability weighting.

### WarpCutProc1

Produces straight cuts, arithmetic rolls (equal spacing), or geometric rolls (accelerating/decelerating). The geometric rolls generate very short cuts that are pre-rendered to WAV.

| Parameter         | Default | Description                                                       |
| ----------------- | ------- | ----------------------------------------------------------------- |
| Straight chance   | 0.5     | Probability of a single-cut (non-roll) block                      |
| Arithmetic chance | 0.7     | Probability of equal-spacing vs geometric spacing for rolls       |
| Accel chance      | 0.6     | Probability of acceleration (vs deceleration) for geometric rolls |
| Accel factor      | 0.9     | Geometric ratio (closer to 1 = more gradual)                      |

### SQPusher1

Inspired by Squarepusher-style drum programming. Sparse activity with periodic fill sections.

| Parameter      | Default   | Description                             |
| -------------- | --------- | --------------------------------------- |
| Activity       | 0.1       | Density of cuts (0 = sparse, 1 = dense) |
| Fill frequency | 4 phrases | How often a fill section occurs         |
| Fill scramble  | 0.0       | Randomness of fill ordering             |

### SQPusher2 (Data)

Dataset-driven cut procedure using onset timing derived from analysis of Squarepusher tracks. Produces characteristic syncopated patterns.

| Parameter | Default | Description                                            |
| --------- | ------- | ------------------------------------------------------ |
| Scramble  | 0.0     | Random reordering of onsets (0 = fixed pattern)        |
| Quantise  | 0.0     | Quantisation strength (0 = free, 0.5 = full grid snap) |

### CageCut (Cage)

Fractal form inspired by John Cage's chance operations. Divides the phrase recursively using a fixed proportion set [0.5, 0.25, 0.25]. No user parameters.

### TimelineCut

Applies a 3+3+2 clave pattern (common in Afro-Cuban and breakbeat music). No user parameters.

### BBCPPermute

Permutes a set of equal subdivisions randomly within each phrase.

| Parameter    | Default | Description                          |
| ------------ | ------- | ------------------------------------ |
| Subdivisions | 8       | Number of equal divisions to permute |

### ThrashCutProc1

Kick-and-snare driven cutting. Places cuts at kick and snare offsets within the phrase with random stops.

| Parameter    | Default | Description                                       |
| ------------ | ------- | ------------------------------------------------- |
| Kick offset  | 0.0     | Beat position of the kick within the subdivision  |
| Snare offset | 0.125   | Beat position of the snare within the subdivision |
| Stop chance  | 0.125   | Probability of a silent gap                       |

## Technical notes

- **Loop length** in the dialog should match the actual looping region of the source clip. The extension auto-detects this from the clip's loop markers.
- **Total length** controls how many beats of cuts are generated. Can be longer than the loop length to produce extended rearrangements.
- Pre-rendered roll WAVs are written to the system temp directory and are not cleaned up automatically.
- All cut procedures use pseudo-random generation — re-running with the same settings produces a different result each time.

## Building from source

```bash
npm install
npm run build
npm test
```
