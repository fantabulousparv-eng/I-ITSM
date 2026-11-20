const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLE_VALUES } = require('../constants/itsm');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: [true, 'Password is required'], select: false },
    role: { type: String, enum: ROLE_VALUES, default: ROLES.EMPLOYEE, index: true },

    phone: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },

    /* ---- Technician capabilities used by the assignment strategies ---- */
    skills: { type: [String], default: [] },
    available: { type: Boolean, default: true },
    capacity: { type: Number, default: 8, min: 1 },
    workloadCount: { type: Number, default: 0, min: 0 },
    experienceYears: { type: Number, default: 0, min: 0 },
    /** Services this technician has handled before (experience-based assignment). */
    serviceExperience: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],

    stats: {
      resolvedCount: { type: Number, default: 0 },
      totalResolutionMinutes: { type: Number, default: 0 },
    },

    lastLoginAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

/** Hash the password whenever it is set or changed. */
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isAtCapacity = function isAtCapacity() {
  return this.workloadCount >= this.capacity;
};

userSchema.methods.hasSkill = function hasSkill(skill) {
  return this.skills.some((s) => s.toLowerCase() === String(skill).toLowerCase());
};

/** Average resolution time in minutes (0 when nothing resolved yet). */
userSchema.virtual('avgResolutionMinutes').get(function avgResolutionMinutes() {
  if (!this.stats || !this.stats.resolvedCount) return 0;
  return Math.round(this.stats.totalResolutionMinutes / this.stats.resolvedCount);
});

userSchema.virtual('utilization').get(function utilization() {
  if (!this.capacity) return 0;
  return Math.min(1, this.workloadCount / this.capacity);
});

module.exports = mongoose.model('User', userSchema);
