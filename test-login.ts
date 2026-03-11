import { authenticator } from 'otplib';

const secret = 'F4ZGE5RUJRCVC6SWPFDHG6JTNM2GW4JQ';
const code = authenticator.generate(secret);
console.log(`Generated code: ${code}`);

fetch('http://localhost:8044/api/users/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'superadmin',
    password: 'qwerty123',
    otp_code: code
  })
}).then(async res => {
   const text = await res.text();
   console.log('HTTP:', res.status, text);
}).catch(err => console.error(err));
