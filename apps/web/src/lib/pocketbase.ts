import PocketBase from 'pocketbase';

const pocketbaseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8080';

export const pb = new PocketBase(pocketbaseUrl);

export const getCurrentUser = async () => {
  try {
    return pb.authStore.model;
  } catch {
    return null;
  }
};

export const loginStartup = async (email: string, password: string) => {
  return pb.collection('users').authWithPassword(email, password);
};

export const logout = () => {
  pb.authStore.clear();
};
