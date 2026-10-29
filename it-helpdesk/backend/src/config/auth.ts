const jwtSecret = process.env.JWT_SECRET

if (!jwtSecret) {
  throw new Error('JWT_SECRET must be configured in backend/.env')
}

export const JWT_SECRET = jwtSecret