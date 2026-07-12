import { useState, useEffect } from 'react';

interface DraftData<T> {
  showModal: 'create' | 'edit' | 'view' | null;
  formData: T;
}

export function useFormDraft<T>(key: string, initialFormData: T) {
  // Initialize state from local storage if available
  const [showModal, setShowModal] = useState<'create' | 'edit' | 'view' | null>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: DraftData<T> = JSON.parse(saved);
        return parsed.showModal === 'create' ? 'create' : null;
      }
    } catch (e) {
      console.error('Failed to parse form draft:', e);
    }
    return null;
  });

  const [formData, setFormData] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: DraftData<T> = JSON.parse(saved);
        if (parsed.formData) return parsed.formData;
      }
    } catch (e) {
      console.error('Failed to parse form draft data:', e);
    }
    return initialFormData;
  });

  // Keep local storage in sync when creating
  useEffect(() => {
    if (showModal === 'create' || localStorage.getItem(key)) {
      // Always save if modal is open for creation, or if a draft already exists
      // so we don't lose it if the modal is temporarily closed.
      localStorage.setItem(key, JSON.stringify({ showModal, formData }));
    }
  }, [showModal, formData, key]);

  const clearDraft = () => {
    localStorage.removeItem(key);
    setFormData(initialFormData);
    setShowModal(null);
  };

  const resetForm = () => {
    setFormData(initialFormData);
  };

  return {
    showModal,
    setShowModal,
    formData,
    setFormData,
    clearDraft,
    resetForm
  };
}
