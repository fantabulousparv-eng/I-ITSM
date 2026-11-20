const mongoose = require('mongoose');

/**
 * Atomic sequence generator. Using $inc on a single document avoids the
 * duplicate-ticket-id race that a countDocuments()-based scheme suffers from.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.statics.next = async function next(key, startAt = 0) {
  const doc = await this.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 }, $setOnInsert: { _id: key } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  ).lean();
  if (doc.seq === 1 && startAt) {
    const bumped = await this.findByIdAndUpdate(key, { $set: { seq: startAt } }, { returnDocument: 'after' }).lean();
    return bumped.seq;
  }
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
