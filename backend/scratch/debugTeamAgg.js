require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  
  // Raw query to see exact BSON types
  const teams = await db.collection('teams').find({}).toArray();
  console.log('All Teams (payment fields):');
  teams.forEach(t => {
    console.log(JSON.stringify({
      _id: t._id,
      teamName: t.teamName,
      status: t.status,
      event: t.event,
      eventType: typeof t.event,
      payment_status: t.payment?.status,
      payment_method: t.payment?.method,
      payment_receivedAmount: t.payment?.receivedAmount,
      payment_expectedAmount: t.payment?.expectedAmount,
      payment_cashReceiverName: t.payment?.cashReceiverName,
      has_receivedAmount: 'receivedAmount' in (t.payment || {}),
      has_expectedAmount: 'expectedAmount' in (t.payment || {}),
    }));
  });
  
  // Run the aggregation pipeline
  const pipeline = [
    { $match: { status: 'REGISTERED' } },
    {
      $lookup: {
        from: 'events',
        localField: 'event',
        foreignField: '_id',
        as: '_eventDoc'
      }
    },
    {
      $addFields: {
        _eventFeeRaw: { $arrayElemAt: ['$_eventDoc.registration.registrationFee', 0] },
        _eventFound: { $gt: [{ $size: '$_eventDoc' }, 0] }
      }
    },
    {
      $addFields: {
        _eventFee: {
          $cond: ['$_eventFound', { $ifNull: ['$_eventFeeRaw', 0] }, null]
        }
      }
    },
    {
      $addFields: {
        _resolvedReceivedAmount: {
          $switch: {
            branches: [
              { case: { $ne: ['$payment.receivedAmount', null] }, then: '$payment.receivedAmount' },
              { case: { $ne: ['$payment.expectedAmount', null] }, then: '$payment.expectedAmount' },
              { case: { $ne: ['$_eventFee', null] }, then: '$_eventFee' }
            ],
            default: null
          }
        }
      }
    },
    {
      $project: {
        teamName: 1,
        'payment.status': 1,
        'payment.method': 1,
        'payment.receivedAmount': 1,
        'payment.expectedAmount': 1,
        _eventFeeRaw: 1,
        _eventFound: 1,
        _eventFee: 1,
        _resolvedReceivedAmount: 1
      }
    }
  ];
  
  console.log('\nAggregation debug:');
  const result = await db.collection('teams').aggregate(pipeline).toArray();
  result.forEach(r => console.log(JSON.stringify(r, null, 2)));
  
  await mongoose.disconnect();
}).catch(e => { console.error('DB error:', e.message); process.exit(1); });
