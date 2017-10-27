const request = require('axios');

const INDEX_URL = 'https://index.stackstorm.org/v1/index.json';

let index;

module.exports.getIndex = async () => {
  if (!index) {
    index = await request.get(INDEX_URL).then(res => res.data);
  }

  return index;
}
