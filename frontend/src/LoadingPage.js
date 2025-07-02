import React from 'react';
import './LoadingPage.css';
import loadingImage from './logo.svg'; // 请替换为实际图片路径

function LoadingPage() {
    return (
        <div className="loading-page">
            <div className="loading-content">
                <img src={loadingImage} alt="加载中" className="loading-image" />
                <p className="loading-text">连接中，请稍候...</p>
            </div>
        </div>
    );
}

export default LoadingPage;