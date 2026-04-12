require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const supabase = require('./supabase');

async function test() {
  const { data, error } = await supabase
    .from('societies')
    .select('*');
  if (error) console.error('DB Error:', error.message);
  else console.log('DB connected. Societies:', data);
}
test();