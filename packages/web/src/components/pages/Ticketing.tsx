import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { ProgressStepper } from '../ProgressStepper';
import {
  useRaffleDetails,
  useCusdAllowance,
  useCusdBalance,
  useApproveToken,
  useEnterRaffle,
  useWaitForTransactionReceipt,
  formatUsd6,
} from '../../web3/hooks';
import { contracts } from '../../web3/config';
import { RaffleVaultAbi, ERC20Abi } from '../../web3/abis';
import type { Address } from 'viem';

interface TicketingProps {
  onBack: () => void;
  onSuccess: () => void;
}

export function Ticketing({ onBack, onSuccess }: TicketingProps) {
  const { address: vaultParam } = useParams<{ address: string }>();
  const vault = vaultParam as Address | undefined;

  const { address: userAddress, isConnected } = useAccount();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedCharity, setSelectedCharity] = useState('');
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });

  const steps = ['Connect', 'Buy Ticket', 'Choose Charity'];

  // Contract reads
  const { data: details } = useRaffleDetails(vault);
  const closesAt = details?.[2]?.result as bigint | undefined;
  const beneficiaryOptions = details?.[9]?.result as Address[] | undefined;
  const raffleParams = details?.[10]?.result as { ticketPriceUsd6: bigint } | undefined;
  const ticketPrice = raffleParams?.ticketPriceUsd6 ?? 100000n; // default $0.10

  const { data: allowance } = useCusdAllowance(userAddress, vault);
  const { data: usdcBalance } = useCusdBalance(userAddress);

  // Write hooks
  const { writeContract: approveWrite, data: approveTxHash, isPending: isApprovePending } = useApproveToken();
  const { writeContract: enterWrite, data: enterTxHash, isPending: isEnterPending } = useEnterRaffle();

  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({ hash: approveTxHash });
  const { isLoading: isEnterConfirming, isSuccess: isEnterConfirmed } =
    useWaitForTransactionReceipt({ hash: enterTxHash });

  // Auto-advance: if wallet already connected, skip connect step
  useEffect(() => {
    if (isConnected && currentStep === 0) setCurrentStep(1);
  }, [isConnected]);

  // After approve confirms, advance to charity step
  useEffect(() => {
    if (isApproveConfirmed) setCurrentStep(2);
  }, [isApproveConfirmed]);

  // After enter confirms, call onSuccess
  useEffect(() => {
    if (isEnterConfirmed) onSuccess();
  }, [isEnterConfirmed]);

  // Countdown from contract closesAt
  useEffect(() => {
    const update = () => {
      const target = closesAt ? Number(closesAt) * 1000 : Date.now() + 3600000;
      const diff = Math.max(0, target - Date.now());
      setTimeLeft({
        minutes: Math.floor(diff / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [closesAt]);

  const hasAllowance = allowance !== undefined && allowance >= ticketPrice;
  const hasBalance = usdcBalance !== undefined && usdcBalance >= ticketPrice;

  const handleApproveOrAdvance = () => {
    if (!vault) return;
    if (hasAllowance) {
      // Already approved — skip straight to charity step
      setCurrentStep(2);
    } else {
      approveWrite({
        address: contracts.paymentToken,
        abi: ERC20Abi,
        functionName: 'approve',
        args: [vault, ticketPrice],
      });
    }
  };

  const handleEnter = () => {
    if (!vault || !selectedCharity) return;
    enterWrite({
      address: vault,
      abi: RaffleVaultAbi,
      functionName: 'enterRaffle',
      args: [contracts.paymentToken, selectedCharity as Address],
    });
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4" style={{ color: '#514444' }}>
                Connect your wallet
              </h2>
              <p className="mb-6" style={{ color: '#514444' }}>
                Connect a Base Sepolia wallet to enter the raffle.
              </p>
            </div>
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2" style={{ color: '#514444' }}>
                Buy a Ticket
              </h2>
              <div className="flex items-center justify-center gap-2 mb-4">
                <span>⏰</span>
                <span className="text-lg font-bold text-red-500">
                  {String(timeLeft.minutes).padStart(2, '0')}:
                  {String(timeLeft.seconds).padStart(2, '0')}
                </span>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 space-y-4">
              <div className="flex justify-between text-sm" style={{ color: '#514444' }}>
                <span>Ticket price</span>
                <span className="font-bold">{formatUsd6(ticketPrice)}</span>
              </div>
              <div className="flex justify-between text-sm" style={{ color: '#514444' }}>
                <span>Your USDC balance</span>
                <span className={hasBalance ? '' : 'text-red-500'}>
                  {formatUsd6(usdcBalance)}
                </span>
              </div>
              {hasAllowance && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" /> Approval already set
                </div>
              )}
            </div>

            {!hasBalance && (
              <p className="text-sm text-center text-red-500">
                Insufficient USDC balance. You need {formatUsd6(ticketPrice)} to enter.
              </p>
            )}

            <Button
              onClick={handleApproveOrAdvance}
              disabled={!hasBalance || isApprovePending || isApproveConfirming}
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
            >
              {isApprovePending || isApproveConfirming ? (
                <span className="flex items-center gap-2 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isApprovePending ? 'Confirm in wallet…' : 'Approving…'}
                </span>
              ) : hasAllowance ? (
                'CONTINUE'
              ) : (
                'APPROVE USDC'
              )}
            </Button>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-4" style={{ color: '#514444' }}>
                Choose a Beneficiary
              </h2>
              <p style={{ color: '#514444' }}>
                Your vote decides which beneficiary receives a share of the pool.
              </p>
            </div>

            <div className="bg-white rounded-lg p-6">
              {beneficiaryOptions && beneficiaryOptions.length > 0 ? (
                <RadioGroup value={selectedCharity} onValueChange={setSelectedCharity}>
                  <div className="space-y-3">
                    {beneficiaryOptions.map((addr) => (
                      <div key={addr} className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                        <RadioGroupItem value={addr} id={addr} />
                        <Label htmlFor={addr} className="flex-1 cursor-pointer font-mono text-sm" style={{ color: '#514444' }}>
                          {addr.slice(0, 6)}…{addr.slice(-4)}
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              ) : (
                <p className="text-sm text-center opacity-60" style={{ color: '#514444' }}>
                  No beneficiaries registered for this raffle.
                </p>
              )}
            </div>

            <Button
              onClick={handleEnter}
              disabled={
                (!selectedCharity && !!beneficiaryOptions?.length) ||
                isEnterPending ||
                isEnterConfirming
              }
              className="w-full py-3"
              style={{ backgroundColor: '#bc1f13', color: '#FFFFFF' }}
            >
              {isEnterPending || isEnterConfirming ? (
                <span className="flex items-center gap-2 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isEnterPending ? 'Confirm in wallet…' : 'Entering raffle…'}
                </span>
              ) : (
                `ENTER RAFFLE — ${formatUsd6(ticketPrice)}`
              )}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="mr-2 hover:bg-transparent"
          style={{ color: '#FFFFFF', backgroundColor: 'transparent', transition: 'all 0.2s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#bc1f13'; e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>Join Raffle</h1>
      </div>

      <ProgressStepper currentStep={currentStep} totalSteps={steps.length} steps={steps} />

      <div className="max-w-md mx-auto">
        {renderStep()}
      </div>
    </div>
  );
}
