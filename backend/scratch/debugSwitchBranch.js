// Test: what does $ne with a missing field return in MongoDB aggregation?
require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  
  // Test $ne with missing field vs null
  const pipeline = [
    { $match: { 'payment.status': 'VERIFIED' } },
    {
      $addFields: {
        // Test 1: direct $ne with missing field
        test_ne_missing: { $ne: ['$payment.receivedAmount', null] },
        // Test 2: $ifNull before $ne  
        test_ifNull_ne: { $ne: [{ $ifNull: ['$payment.receivedAmount', null] }, null] },
        // Test 3: $gt with missing field
        test_type: { $type: '$payment.receivedAmount' },
        // Test 4: use $gt to check if it's a number
        actualReceivedAmount: '$payment.receivedAmount',
        actualExpectedAmount: '$payment.expectedAmount',
      }
    },
    { $project: { teamName: 1, test_ne_missing: 1, test_ifNull_ne: 1, test_type: 1, actualReceivedAmount: 1, actualExpectedAmount: 1 } }
  ];
  
  console.log('\n=== TEAMS: field presence test ===');
  const r1 = await db.collection('teams').aggregate(pipeline).toArray();
  r1.forEach(r => console.log(JSON.stringify(r)));

  // Also test $switch specifically
  const pipeline2 = [
    { $match: { 'payment.status': 'VERIFIED' } },
    {
      $addFields: {
        switchResult: {
          $switch: {
            branches: [
              { 
                case: { $gt: ['$payment.receivedAmount', null] }, 
                then: { $literal: 'receivedAmount branch taken' } 
              },
              { 
                case: { $gt: ['$payment.expectedAmount', null] }, 
                then: { $literal: 'expectedAmount branch taken' } 
              },
              { 
                case: true, 
                then: { $literal: 'default branch' } 
              }
            ],
            default: 'switch default'
          }
        },
        switchResultWithIfNull: {
          $switch: {
            branches: [
              { 
                case: { $ne: [{ $ifNull: ['$payment.receivedAmount', null] }, null] }, 
                then: { $literal: 'receivedAmount branch taken' } 
              },
              { 
                case: { $ne: [{ $ifNull: ['$payment.expectedAmount', null] }, null] }, 
                then: { $literal: 'expectedAmount branch taken' } 
              },
              { 
                case: true, 
                then: { $literal: 'eventFee branch' } 
              }
            ],
            default: 'switch default'
          }
        }
      }
    },
    { $project: { teamName: 1, switchResult: 1, switchResultWithIfNull: 1 } }
  ];
  
  console.log('\n=== TEAMS: $switch branch test ===');
  const r2 = await db.collection('teams').aggregate(pipeline2).toArray();
  r2.forEach(r => console.log(JSON.stringify(r)));
  
  await mongoose.disconnect();
}).catch(e => { console.error('DB error:', e.message); process.exit(1); });
