import { useState } from 'react';
import { api } from '../api.js';
import { fmt } from '../format.js';
import { Modal, useCatalog, useConfirm, useLoad, useToast } from '../components/ui.jsx';

export default function Categories() {
  const { jars, reload: reloadCatalog } = useCatalog();
  const [type, setType] = useState('expense');
  const [rows, reload] = useLoad(() => api.get(`/categories?type=${type}`), [type]);
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const refresh = () => { reload(); reloadCatalog(); };

  async function quickJar(c, jar_id) {
    await api.put(`/categories/${c.id}`, { jar_id: jar_id || null });
    toast(`Đã gắn "${c.name}" vào hũ`);
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1><span className="emo">🏷️</span>Danh mục thu / chi</h1>
          <div className="faint">Mỗi khoản chi gắn với 1 hũ để theo dõi ngân sách. "Tên gọi tắt" giúp chat AI nhận diện.</div>
        </div>
        <button className="primary" onClick={() => setEdit({ type })}>+ Thêm khoản {type === 'expense' ? 'chi' : 'thu'}</button>
      </div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={type === 'expense' ? 'on exp' : ''} onClick={() => setType('expense')}>Khoản chi</button>
        <button className={type === 'income' ? 'on inc' : ''} onClick={() => setType('income')}>Khoản thu</button>
      </div>
      <div className="card table-wrap" style={{ padding: 6 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Tên</th>
              {type === 'expense' && <th>Hũ</th>}
              <th className="hide-sm">Tên gọi tắt (chat)</th>
              <th className="r">Tháng này</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows?.map((c) => (
              <tr key={c.id}>
                <td><span style={{ marginRight: 6 }}>{c.icon}</span><b>{c.name}</b></td>
                {type === 'expense' && (
                  <td style={{ minWidth: 170 }}>
                    <select value={c.jar_id || ''} onChange={(e) => quickJar(c, e.target.value)} aria-label={`Hũ của ${c.name}`}>
                      <option value="">— Chưa gắn —</option>
                      {jars.map((j) => <option key={j.id} value={j.id}>{j.icon} {j.name}</option>)}
                    </select>
                  </td>
                )}
                <td className="faint hide-sm" style={{ maxWidth: 320 }}>{c.aliases}</td>
                <td className="r num">{fmt(c.month_total)}</td>
                <td className="r"><button className="sm ghost" onClick={() => setEdit(c)}>Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <CatModal c={edit} jars={jars} onClose={() => setEdit(null)} onSaved={refresh} />}
    </>
  );
}

function CatModal({ c, jars, onClose, onSaved }) {
  const toast = useToast();
  const ask = useConfirm();
  const [f, setF] = useState({ name: c.name || '', type: c.type, icon: c.icon || '', jar_id: c.jar_id || '', aliases: c.aliases || '' });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  async function save() {
    try {
      const body = { ...f, jar_id: f.jar_id || null };
      if (c.id) await api.put(`/categories/${c.id}`, body);
      else await api.post('/categories', body);
      toast('Đã lưu');
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function remove() {
    if (!(await ask(`Xoá "${c.name}"?`))) return;
    const r = await api.del(`/categories/${c.id}`);
    toast(r.archived ? 'Đã có giao dịch → chuyển sang lưu trữ' : 'Đã xoá');
    onSaved();
    onClose();
  }
  return (
    <Modal
      title={c.id ? 'Sửa danh mục' : `Thêm khoản ${c.type === 'expense' ? 'chi' : 'thu'}`}
      onClose={onClose}
      footer={<>{c.id && <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>Xoá</button>}<button onClick={onClose}>Huỷ</button><button className="primary" onClick={save}>Lưu</button></>}
    >
      <div className="form-grid">
        <label className="field">Tên<input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label className="field">Biểu tượng (emoji)<input value={f.icon} onChange={(e) => set('icon', e.target.value)} placeholder="🍜" /></label>
        {f.type === 'expense' && (
          <label className="field full">Thuộc hũ
            <select value={f.jar_id} onChange={(e) => set('jar_id', e.target.value)}>
              <option value="">— Chưa gắn —</option>
              {jars.map((j) => <option key={j.id} value={j.id}>{j.icon} {j.name}</option>)}
            </select>
          </label>
        )}
        <label className="field full">Tên gọi tắt / từ khoá cho chat (cách nhau dấu phẩy)
          <textarea rows={2} value={f.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="VD: đồ ăn, cơm, phở, cafe" />
        </label>
      </div>
    </Modal>
  );
}
