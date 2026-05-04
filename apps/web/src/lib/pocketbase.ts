import PocketBase from 'pocketbase';

const pocketbaseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8080';

export const pb = new PocketBase(pocketbaseUrl);

export const getClientAuth = () => pb.authStore.model;

export const loginWithPassword = async (email: string, password: string) =>
  pb.collection('users').authWithPassword(email, password);

export const logout = () => pb.authStore.clear();
