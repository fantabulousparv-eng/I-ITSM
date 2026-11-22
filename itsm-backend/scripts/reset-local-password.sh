#!/usr/bin/env bash
# Run from Git Bash to reset an account in the local development database.
set -eu
cd "$(dirname "$0")/.."
email=${1:?Usage: bash scripts/reset-local-password.sh email}
IFS= read -rs -p 'New password (at least 8 characters, including a letter and a number): ' password
printf '\n'
IFS= read -rs -p 'Confirm new password: ' confirmation
printf '\n'
if [[ "$password" != "$confirmation" ]]; then
  echo 'Passwords did not match. Nothing was changed.' >&2
  exit 1
fi
printf '%s' "$password" | node -e '
  const mongoose = require("mongoose");
  const validate = require("./utils/validate");
  const User = require("./models/User");
  async function reset() {
    const email = validate.email(process.argv[1]);
    const password = validate.password(require("fs").readFileSync(0, "utf8"));
    if (password !== password.trim() || Buffer.byteLength(password) > 72) {
      throw new Error("Use at most 72 bytes and avoid leading or trailing spaces.");
    }
    await mongoose.connect("mongodb://127.0.0.1:27017/itsm_db", { serverSelectionTimeoutMS: 5000 });
    const user = await User.findOne({ email });
    if (!user) throw new Error("No matching local account.");
    if (user.active === false) throw new Error("This account is deactivated.");
    user.password = password;
    await user.save();
    console.log("Password reset. You can now sign in.");
  }
  reset().catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
' "$email"
