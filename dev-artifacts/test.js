const fs = require('fs');
let code = fs.readFileSync('public/js/catalogue.js', 'utf8');
code += `
let missing = [];
let total = 0;
for (const [inst, instData] of Object.entries(CATALOGUE)) {
  for (const [taal, taalData] of Object.entries(instData.taals || {})) {
    for (const [raag, raagData] of Object.entries(taalData.raags || {})) {
      total++;
      if (raagData.file) {
        if (!fs.existsSync('assets/' + raagData.file + '.aac')) {
          missing.push({inst, taal, raag, file: raagData.file + '.aac'});
        }
      } else {
        missing.push({inst, taal, raag, file: null});
      }
    }
  }
}
console.log('Total:', total);
console.log('Missing:', missing.length);
fs.writeFileSync('missing.json', JSON.stringify(missing, null, 2));
`;
eval(code);
