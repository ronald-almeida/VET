export const digits = (value) => String(value ?? '').replace(/\D/g, '');

export function validDocument(value) {
  const number = String(value ?? '').replace(/[^\da-z]/gi, '').toUpperCase();
  if (/^(.)\1+$/.test(number)) return false;
  if (/^\d{11}$/.test(number)) {
    const check = (length) => {
      let sum = 0;
      for (let index = 0; index < length; index++) sum += Number(number[index]) * (length + 1 - index);
      const digit = (sum * 10) % 11;
      return (digit === 10 ? 0 : digit) === Number(number[length]);
    };
    return check(9) && check(10);
  }
  if (/^[A-Z\d]{12}\d{2}$/.test(number)) {
    const check = (length) => {
      let sum = 0;
      for (let index = 0; index < length; index++) sum += (number.charCodeAt(index) - 48) * ((length - 1 - index) % 8 + 2);
      const remainder = sum % 11;
      return (remainder < 2 ? 0 : 11 - remainder) === Number(number[length]);
    };
    return check(12) && check(13);
  }
  return false;
}

export function validateCustomer(customer) {
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email ?? '')) errors.email = 'Digite um email válido.';
  if (String(customer.confirmEmail ?? '').trim().toLowerCase() !== String(customer.email ?? '').trim().toLowerCase()) errors['confirm-email'] = 'Os emails precisam ser iguais.';
  if (String(customer.name ?? '').trim().split(/\s+/).length < 2 || String(customer.name).trim().length < 5) errors.name = 'Digite seu nome e sobrenome.';
  if (!validDocument(customer.document)) errors.document = 'Digite um CPF ou CNPJ válido.';
  if (!/^[1-9]{2}\d{8,9}$/.test(digits(customer.phone))) errors.phone = 'Digite seu celular com DDD.';
  if (customer.postalCode && digits(customer.postalCode).length !== 8) errors['postal-code'] = 'O CEP deve conter 8 dígitos.';
  return errors;
}

export function formatPhone(value) {
  const number = digits(value).slice(0, 11);
  if (number.length < 3) return number;
  const subscriber = number.slice(2);
  return `(${number.slice(0, 2)}) ${subscriber.length > 4 ? subscriber.slice(0, -4) + '-' + subscriber.slice(-4) : subscriber}`;
}

export function formatDocument(value) {
  const number = value.replace(/[^\da-z]/gi, '').toUpperCase().slice(0, 14);
  if (/^[\d]*$/.test(number) && number.length <= 11) return number.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  return number.replace(/^(.{2})(.)/, '$1.$2').replace(/^(.{2})\.(.{3})(.)/, '$1.$2.$3').replace(/^(.{2})\.(.{3})\.(.{3})(.)/, '$1.$2.$3/$4').replace(/\/(.{4})(.)/, '/$1-$2');
}
