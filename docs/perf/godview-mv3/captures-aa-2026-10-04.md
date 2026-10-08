# Godview captures — A/A (the control)

- A: `/Volumes/SamsungRed/lanes/mv/mv3c/vibe-field` (source: fold)
- A′: `/Volumes/SamsungRed/lanes/mv/mv3c/vibe-field` (source: fold)
- corpus `n=20,duration=8000,seed=1`, frames 2500,7900 ms, themes dark,light, views swarm,list,rain,timeline
- window offscreen, scale 2; clock frozen per frame; pinned {"timezone":true,"locale":true,"motion":true}; motion reduce
- a pixel differs past 24/255 on any channel; a capture differs past 0.100 % of its pixels, or past twice its own A/A share when that already exceeds the threshold
- verdicts: unstable 8 · stable 8
- sanity (the diff sees a theme change): 8/8

| capture | A/A differs | max Δ | box | verdict |
|---|---|---|---|---|
| swarm-dark-t2500 | 27.529 % | 255 | 126,80–2343,623 | unstable |
| swarm-dark-t7900 | 37.598 % | 255 | 131,80–2343,623 | unstable |
| list-dark-t2500 | 0.000 % | 0 | – | stable |
| list-dark-t7900 | 0.000 % | 0 | – | stable |
| rain-dark-t2500 | 3.759 % | 255 | 41,80–2343,589 | unstable |
| rain-dark-t7900 | 3.816 % | 255 | 70,80–2338,589 | unstable |
| timeline-dark-t2500 | 0.000 % | 0 | – | stable |
| timeline-dark-t7900 | 0.000 % | 0 | – | stable |
| swarm-light-t2500 | 32.606 % | 237 | 127,80–2331,623 | unstable |
| swarm-light-t7900 | 41.867 % | 243 | 132,80–2343,623 | unstable |
| list-light-t2500 | 0.000 % | 0 | – | stable |
| list-light-t7900 | 0.000 % | 0 | – | stable |
| rain-light-t2500 | 3.783 % | 255 | 41,80–2343,588 | unstable |
| rain-light-t7900 | 4.424 % | 255 | 45,80–2339,588 | unstable |
| timeline-light-t2500 | 0.000 % | 0 | – | stable |
| timeline-light-t7900 | 0.000 % | 0 | – | stable |
