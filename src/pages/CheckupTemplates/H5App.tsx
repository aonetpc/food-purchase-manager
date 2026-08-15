import { Routes, Route, Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import { useEffect } from 'react';
import ListPage from './ListPage';
import WizardNew from './WizardNew';
import WizardItems from './WizardItems';
import WizardFinish from './WizardFinish';

export default function H5App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route index element={<ListPage />} />
        <Route path="new" element={<WizardNew />} />
        <Route path=":id/items" element={<WizardItems />} />
        <Route path=":id/finish" element={<WizardFinish />} />
        <Route path=":id" element={<TemplateDetailRouter />} />
        <Route path="*" element={<Navigate to="/h/checkup-templates" replace />} />
      </Routes>
    </div>
  );
}

function TemplateDetailRouter() {
  const { id } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (id) navigate(`/h/checkup-templates/${id}/finish`, { replace: true });
  }, [id, navigate]);
  return null;
}
