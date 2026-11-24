import { createContext, useContext, useState } from 'react';

const AdminContext = createContext(['', () => {}]);
export function AdminProvider({ children }) {
  const state = useState('');
  return <AdminContext.Provider value={state}>{children}</AdminContext.Provider>;
}
export function useAdmin() { return useContext(AdminContext); }
