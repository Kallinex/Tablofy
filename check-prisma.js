const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
console.log('$extends' in p ? 'has $extends' : 'no $extends');
console.log('$use' in p ? 'has $use' : 'no $use');
console.log('_extensions' in p ? 'has _extensions' : 'no _extensions');
