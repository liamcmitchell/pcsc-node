#include "async_workers.h"
#include "pcsc_errors.h"
#include <cstring>

// ============================================================================
// TransmitWorker
// ============================================================================

TransmitWorker::TransmitWorker(
    Napi::Env env,
    SCARDHANDLE card,
    DWORD protocol,
    std::vector<uint8_t> sendBuffer,
    size_t maxRecvLength,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      card_(card),
      protocol_(protocol),
      sendBuffer_(std::move(sendBuffer)),
      recvLength_(0),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
    // Pre-allocate receive buffer with configurable size
    // Default is 258 (standard APDU: 256 data + 2 status bytes)
    // Max is 262144 (256KB) for extended APDUs
    size_t bufferSize = maxRecvLength;
    if (bufferSize == 0) {
        bufferSize = 258;  // Default
    } else if (bufferSize > 262144) {
        bufferSize = 262144;  // Cap at 256KB
    }
    recvBuffer_.resize(bufferSize);
}

void TransmitWorker::Execute() {
    // Select protocol-specific PCI structure
    const SCARD_IO_REQUEST* pioSendPci;
    if (protocol_ == SCARD_PROTOCOL_T0) {
        pioSendPci = SCARD_PCI_T0;
    } else if (protocol_ == SCARD_PROTOCOL_T1) {
        pioSendPci = SCARD_PCI_T1;
    } else {
        pioSendPci = SCARD_PCI_RAW;
    }

    recvLength_ = static_cast<DWORD>(recvBuffer_.size());

    result_ = SCardTransmit(
        card_,
        pioSendPci,
        sendBuffer_.data(),
        static_cast<DWORD>(sendBuffer_.size()),
        nullptr,
        recvBuffer_.data(),
        &recvLength_
    );
}

void TransmitWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
            env, recvBuffer_.data(), recvLength_);
        deferred_.Resolve(buffer);
    } else {
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
    }
}

void TransmitWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// ControlWorker
// ============================================================================

ControlWorker::ControlWorker(
    Napi::Env env,
    SCARDHANDLE card,
    DWORD controlCode,
    std::vector<uint8_t> sendBuffer,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      card_(card),
      controlCode_(controlCode),
      sendBuffer_(std::move(sendBuffer)),
      bytesReturned_(0),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
    // Pre-allocate receive buffer
    recvBuffer_.resize(256);
}

void ControlWorker::Execute() {
    result_ = SCardControl(
        card_,
        controlCode_,
        sendBuffer_.empty() ? nullptr : sendBuffer_.data(),
        static_cast<DWORD>(sendBuffer_.size()),
        recvBuffer_.data(),
        static_cast<DWORD>(recvBuffer_.size()),
        &bytesReturned_
    );
}

void ControlWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
            env, recvBuffer_.data(), bytesReturned_);
        deferred_.Resolve(buffer);
    } else {
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
    }
}

void ControlWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// ConnectWorker
// ============================================================================

ConnectWorker::ConnectWorker(
    Napi::Env env,
    SCARDCONTEXT context,
    std::string readerName,
    DWORD shareMode,
    DWORD preferredProtocols,
    SCARDHANDLE* cardOut,
    DWORD* protocolOut,
    bool* connectedOut,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      context_(context),
      readerName_(std::move(readerName)),
      shareMode_(shareMode),
      preferredProtocols_(preferredProtocols),
      card_(0),
      activeProtocol_(0),
      cardOut_(cardOut),
      protocolOut_(protocolOut),
      connectedOut_(connectedOut),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
}

void ConnectWorker::Execute() {
    result_ = SCardConnect(
        context_,
        readerName_.c_str(),
        shareMode_,
        preferredProtocols_,
        &card_,
        &activeProtocol_
    );
}

void ConnectWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        *cardOut_ = card_;
        *protocolOut_ = activeProtocol_;
        *connectedOut_ = true;
        deferred_.Resolve(env.Undefined());
    } else {
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
    }
}

void ConnectWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// ReconnectWorker
// ============================================================================

ReconnectWorker::ReconnectWorker(
    Napi::Env env,
    SCARDHANDLE card,
    DWORD shareMode,
    DWORD preferredProtocols,
    DWORD initialization,
    DWORD* protocolOut,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      card_(card),
      shareMode_(shareMode),
      preferredProtocols_(preferredProtocols),
      initialization_(initialization),
      activeProtocol_(0),
      protocolOut_(protocolOut),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
}

void ReconnectWorker::Execute() {
    result_ = SCardReconnect(
        card_,
        shareMode_,
        preferredProtocols_,
        initialization_,
        &activeProtocol_
    );
}

void ReconnectWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        if (protocolOut_) {
            *protocolOut_ = activeProtocol_;
        }
        deferred_.Resolve(env.Undefined());
    } else {
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
    }
}

void ReconnectWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}
