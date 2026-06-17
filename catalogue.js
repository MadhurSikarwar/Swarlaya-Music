// ═══════════════════════════════════════════════
//  LEHRA STUDIO — MUSIC CATALOGUE
//  Derived from data.plist (audio files by Madhu)
//  Taals are ordered by beat count ascending.
// ═══════════════════════════════════════════════

const CATALOGUE = {
  "Sarangi": {
    tuningCoeff: 1.05945651,
    taals: {
      // 7 beats
      "Roopak (7 beats)": {
        beats: 7, taali: [4, 6], khali: [1], minTempo: 60, maxTempo: 240,
        tempos: [75, 90, 120, 150, 180],
        raags: {
          "Charukeshi": { file: "Sarangi_Roopak Taal_Charukeshi" }
        }
      },
      // 10 beats
      "Jhaptaal (10 beats)": {
        beats: 10, taali: [1, 3, 8], khali: [6], minTempo: 30, maxTempo: 180,
        tempos: [40, 50, 60, 75, 90, 120, 150],
        raags: {
          "Bageshree": { file: "Sarangi_Jhaptaal_Bageshree" },
          "Bahar":     { file: "Sarangi_Jhaptaal_Bahar" }
        }
      },
      // 13 beats
      "Jai Taal (13 beats)": {
        beats: 13, taali: [1, 6, 11], khali: [8], minTempo: 45, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Jog": { file: "Sarangi_Jai Taal_Jog" }
        }
      },
      // 15 beats
      "Pancham Sawari (15 beats)": {
        beats: 15, taali: [1, 4, 12], khali: [8], minTempo: 60, maxTempo: 180,
        tempos: [75, 90, 120, 150],
        raags: {
          "Charukeshi": { file: "Sarangi_Pancham Sawari_Charukeshi" }
        }
      },
      // 16 beats
      "Teentaal (16 beats)": {
        beats: 16, taali: [1, 5, 13], khali: [9], minTempo: 30, maxTempo: 500,
        tempos: [40, 50, 60, 75, 90, 120, 150, 180, 240, 320],
        raags: {
          "Bhairavi":      { file: "Sarangi_Teentaal_Bhairavi" },
          "Bhupali":       { file: "Sarangi_Teentaal_Bhupali" },
          "Desh":          { file: "Sarangi_Teentaal_Desh" },
          "Jog":           { file: "Sarangi_Teentaal_Jog" },
          "Madhukauns":    { file: "Sarangi_Teentaal_Madhukauns" },
          "Mand":          { file: "Sarangi_Teentaal_Mand" },
          "Nat Bhairav":   { file: "Sarangi_Teentaal_Nat Bhairav" },
          "Kalawati":      { file: "Sarangi_Teentaal_Kalawati" },
          "Gorak Kalyan":  { file: "Sarangi_Teentaal_Gorah Kalyan" },
          "Chandrakauns":  { file: "Sarangi_Teentaal_Chandrakauns" },
          "Binna Shadja":  { file: "Sarangi_Teentaal_Binna Shadja" }
        }
      }
    }
  },

  "Esraj": {
    tuningCoeff: 1.0,
    taals: {
      // 7 beats
      "Roopak Taal (7 beats)": {
        beats: 7, taali: [4, 6], khali: [1], minTempo: 65, maxTempo: 240,
        tempos: [75, 90, 120, 150, 180],
        raags: {
          "Kedar": { file: "Esraj_Roopak_Kedar" }
        }
      },
      // 9 beats
      "Matta Taal (9 beats)": {
        beats: 9, minTempo: 50, maxTempo: 150,
        tempos: [60, 75, 90, 120],
        raags: {
          "Darbari Kanada": { file: "Esraj_Matta Taal_Darbari Kanada" }
        }
      },
      // 13 beats
      "Jai Taal (13 beats)": {
        beats: 13, taali: [1, 6, 11], khali: [8], minTempo: 50, maxTempo: 180,
        tempos: [60, 75, 90, 120, 150],
        raags: {
          "Alhayia Bilwal": { file: "Esraj_Jai Taal_Alhayia Bilwal" }
        }
      },
      // 14 beats (double cycle of 7)
      "Roopak Double Cycle (14 beats)": {
        beats: 14, minTempo: 65, maxTempo: 240,
        tempos: [75, 90, 120, 150, 180],
        raags: {
          "Kedar": { file: "Esraj_Roopak_Kedar_Double" }
        }
      },
      // 16 beats
      "Teentaal (16 beats)": {
        beats: 16, taali: [1, 5, 13], khali: [9], minTempo: 30, maxTempo: 500,
        tempos: [40, 50, 60, 75, 90, 120, 150, 180, 240, 300],
        raags: {
          "Chandrakauns": { file: "Esraj_Teentaal_Chandrakauns" },
          "Bageshree":    { file: "Esraj_Teentaal_Bageshree" },
          "Sohini":       { file: "Esraj_Teentaal_Sohini" },
          "Kirwani":      { file: "Esraj_Teentaal_Kirwani" },
          "Misra Tilang": { file: "Esraj_Teentaal_Misra Tilang" },
          "Jaijaiwanti":  { file: "Esraj_Teentaal_Jaijaiwanti" },
          "Charukeshi":   { file: "Esraj_Teentaal_Charukeshi" },
          "Madhuwanti":   { file: "Esraj_Teentaal_Madhuwanti" },
          "Saraswati":    { file: "Esraj_Teentaal_Saraswati" }
        }
      }
    }
  },

  "Harmonium": {
    tuningCoeff: 1.0,
    taals: {
      // 7 beats
      "Roopak Taal (7 beats)": {
        beats: 7, taali: [4, 6], khali: [1], minTempo: 55, maxTempo: 240,
        tempos: [75, 90, 120, 150, 180],
        raags: {
          "Patdeep": { file: "Harmonium_Roopak Taal_Patdeep" }
        }
      },
      // 10 beats (Jhaptaal)
      "Jhaptaal (10 beats)": {
        beats: 10, taali: [1, 3, 8], khali: [6], minTempo: 30, maxTempo: 180,
        tempos: [40, 50, 60, 75, 90, 120],
        raags: {
          "Jaijawanti": { file: "Harmonium_Jhaptaal_Jaijawanti" },
          "Tilang":     { file: "Harmonium_Jhaptaal_Tilang" }
        }
      },
      // 10 beats (Sool Taal)
      "Sool Taal (10 beats)": {
        beats: 10, taali: [1, 5, 7], khali: [3, 9], minTempo: 55, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Kedar": { file: "Harmonium_Sool Taal_Kedar" }
        }
      },
      // 12 beats
      "Ektaal (12 beats)": {
        beats: 12, taali: [1, 5, 9, 11], khali: [3, 7], minTempo: 50, maxTempo: 240,
        tempos: [60, 75, 90, 120, 150, 180],
        raags: {
          "Gavti": { file: "Harmonium_Ek Taal_Gavti" }
        }
      },
      // 14 beats
      "Dhamar (14 beats)": {
        beats: 14, taali: [1, 6, 11], khali: [8], minTempo: 55, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Charukeshi": { file: "Harmonium_Dhamar_Charukeshi" }
        }
      },
      // 15 beats
      "Pancham Sawari (15 beats)": {
        beats: 15, taali: [1, 4, 12], khali: [8], minTempo: 45, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Chandrakauns": { file: "Harmonium_Pancham Sawari_Chandrakauns" }
        }
      },
      // 16 beats
      "Teentaal (16 beats)": {
        beats: 16, taali: [1, 5, 13], khali: [9], minTempo: 30, maxTempo: 500,
        tempos: [40, 50, 60, 75, 90, 120, 150, 180, 240, 320],
        raags: {
          "Kirwani":        { file: "Harmonium_Teentaal_Kirwani" },
          "Misra Bhairavi": { file: "Harmonium_Teentaal_Misra Bhairavi" },
          "Bilaskhani Todi":{ file: "Harmonium_Teentaal_Bilaskhani Todi" },
          "Misra Kirwani":  { file: "Harmonium_Teentaal_Misra Kirwani" },
          "Misra Madhuwanti":{ file: "Harmonium_Teentaal_Misra Madhuwanti" },
          "Todi":           { file: "Harmonium_Teentaal_Todi" }
        }
      }
    }
  },

  "Sitar": {
    tuningCoeff: 1.0,
    taals: {
      // 7 beats
      "Roopak Taal (7 beats)": {
        beats: 7, taali: [4, 6], khali: [1], minTempo: 60, maxTempo: 240,
        tempos: [75, 90, 120, 150, 180],
        raags: {
          "Bageshree": { file: "Sitar_Roopak Taal_Bhageshree" }
        }
      },
      // 10 beats
      "Jhaptaal (10 beats)": {
        beats: 10, taali: [1, 3, 8], khali: [6], minTempo: 30, maxTempo: 150,
        tempos: [40, 50, 60, 75, 90, 120],
        raags: {
          "Tilak Kamod":  { file: "Sitar_Jhaptaal_Tilak Kamod" },
          "Shivranjani":  { file: "Sitar_Jhaptaal_Shivranjani" }
        }
      },
      // 11 beats
      "Rudra Taal (11 beats)": {
        beats: 11, minTempo: 50, maxTempo: 180,
        tempos: [60, 75, 90, 120, 150],
        raags: {
          "Kedar": { file: "Sitar_Rudra Taal_Kedar" }
        }
      },
      // 12 beats
      "Ektaal (12 beats)": {
        beats: 12, taali: [1, 5, 9, 11], khali: [3, 7], minTempo: 50, maxTempo: 240,
        tempos: [60, 75, 90, 120, 150, 180],
        raags: {
          "Kedar": { file: "Sitar_Ektaal_Kedar" }
        }
      },
      // 13 beats
      "Jai Taal (13 beats)": {
        beats: 13, taali: [1, 6, 11], khali: [8], minTempo: 45, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Hindol": { file: "Sitar_Jai Taal_Hindol" }
        }
      },
      // 15 beats (Neel Taal = 7.5 × 2)
      "Neel Taal (15 beats)": {
        beats: 15, minTempo: 60, maxTempo: 180,
        tempos: [75, 90, 120, 150],
        raags: {
          "Bageshree": { file: "Sitar_Neel Taal_Bageshree_Double" }
        }
      },
      // 15 beats (Pancham Sawari)
      "Pancham Sawari (15 beats)": {
        beats: 15, taali: [1, 4, 12], khali: [8], minTempo: 45, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Hansadhwani": { file: "Sitar_Pancham Sawari_Hansadhwani" }
        }
      },
      // 16 beats
      "Teentaal (16 beats)": {
        beats: 16, taali: [1, 5, 13], khali: [9], minTempo: 30, maxTempo: 500,
        tempos: [40, 50, 60, 75, 90, 120, 150, 180, 240, 320],
        raags: {
          "Bhimpalasi":    { file: "Sitar_Teentaal_Bhimpalashree" },
          "Charukeshi":    { file: "Sitar_Teentaal_Charukeshi" },
          "Basant":        { file: "Sitar_Teentaal_Basant" }
        }
      },
      // 19 beats (Sunand Taal = 9.5 × 2)
      "Sunand Taal (19 beats)": {
        beats: 19, minTempo: 45, maxTempo: 180,
        tempos: [50, 60, 75, 90, 120, 150],
        raags: {
          "Hansadhwani": { file: "Sitar_Sunand Taal_Hamsadhwani_Double" }
        }
      },
      // 21 beats (Sardha Roopak = 10.5 × 2)
      "Sardha Roopak (21 beats)": {
        beats: 21, minTempo: 30, maxTempo: 150,
        tempos: [40, 50, 60, 75, 90, 120],
        raags: {
          "Bhimpalashree": { file: "Sitar_Sardha Roopak_Bhimpalashree_Double" }
        }
      }
    }
  }
};
