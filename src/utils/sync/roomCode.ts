// Shared room-code generator so the /party lobby and the "Read together" menu
// can't drift apart. Unambiguous alphabet (no 0/O/1/I/L); 3 chars is plenty at
// ReadParty's tiny scale.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 3;

export const generateRoomCode = (): string => {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
};
