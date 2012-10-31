#!/usr/bin/perl

# Script to launch additional render slaves when running under Amazon AWS
# Will monitor the load level and launch a graded series of spot instances
# to deal with it.
#
# All values are hard-coded as constants during this testing phase
#
# Need following security groups:
# GBrowseMaster
#   allow inbound on 22 from all
#   allow inbound on 80 from all
#
# GBrowseSlave
#   allow inbound on 8101-8105 from GBrowseMaster group
#   (nothing else)

use strict;
use VM::EC2;
use VM::EC2::Instance::Metadata;
use Getopt::Long;

$SIG{TERM} = \&terminate_instances;
$SIG{INT}  = \&terminate_instances;
END {          terminate_instances()  }

# load averages:
# each item represents 15 min load average, lower and upper bound on instances
use constant LOAD_TABLE => [
    #load  min  max
    [ 0.5,  0,   1 ],
    [ 1.0,  0,   2 ],
    [ 2.0,  1,   4 ],
    [ 3.0,  3,   6 ],
    [10.0,  6,   8 ]
    ];

use constant IMAGE_TYPE     => 'm1.small';
use constant POLL_INTERVAL  => 5;  # minutes
use constant SPOT_PRICE     => 0.05;  # dollars/hour
use constant SECURITY_GROUP => 'GBrowseSlave';

my($Access_key,$Secret_key);
GetOptions(
	   'access_key=s'  => \$Access_key,
	   'secret_key=s'  => \$Secret_key,
    ) or exec 'perldoc',$0;

#setup defaults
$ENV{EC2_ACCESS_KEY} = $Access_key if defined $Access_key;
$ENV{EC2_SECRET_KEY} = $Secret_key if defined $Secret_key;

my $meta       = VM::EC2::Instance::Metadata->new();
my $imageId    = $meta->imageId;
my $instanceId = $meta->instanceId;
my $zone       = $meta->availabilityZone;
my @groups     = $meta->securityGroups;

(my $region = $zone) =~ s/[a-z]$//;  #  zone=>region

my $ec2     = VM::EC2->new(-region=>$zone);

while (1) { # main loop
    my $load = get_load();
    my @instances = adjust_spot_requests($load);
    adjust_configuration(@instances);
    sleep (POLL_INTERVAL * 60);
}

terminate_instances();

exit 0;

sub get_load {
    if (-e '/proc/loadavg') {
	open my $fh,'/proc/loadavg';
	my ($one,$five,$fifteen) = split /\s+/,<$fh>;
	return $five;
    } else {
	my $l = `w`;
	my ($one,$five,$fifteen) = $l =~ /load average: ([0-9.]+), ([0-9.]+), ([0-9.]+)/;
	return $five;
    }
}

sub adjust_spot_requests {
    my $load = shift;

    # first find out how many spot instances we want to have
    my ($min_instances,$max_instances) = (0,0);
    my $lt = LOAD_TABLE;
    for my $i (@$lt) {
	my ($load_limit,$min,$max) = @$i;
	if ($load > $load_limit) {
	    $min_instances = $min;
	    $max_instances = $max;
	}
    }

    # count the realized and pending 
    my @spot_requests = $ec2->describe_spot_instance_requests({'tag:Requestor' => 'gbrowse_launch_aws_slaves'});
    my @potential_instances;
    for my $sr (@spot_requests) {
	my $state    = $sr->state;
	my $instance = $sr->instance;
	if ($state eq 'open' or ($instance && $instance->instanceState =~ /running|pending/)) {
	    $instance->add_tag(GBrowseMaster => $instanceId);  # we'll use this to terminate all slaves sometime later
	    push @potential_instances,$instance || $state;
	}
    }
    
    # what to do if there are too many spot requests for the current load
    # either cancel spot requests or shut instances down
    while (@potential_instances > $max_instances) {
	my $i = shift @potential_instances;
	if ($i->isa('VM::EC2::Instance')) {
	    warn "terminating $i";
	    $i->terminate();
	} else {
	    warn "cancelling spot request $i";
	    $ec2->cancel_spot_instance_requests($i);
	}
    }

    # what to do if there are too few
    if (@potential_instances < $min_instances) {
	warn "launching a new spot request";
	my @requests = $ec2->request_spot_instances(
	    -image_id          => $imageId,
	    -instance_type     => IMAGE_TYPE,
	    -instance_count    => 1,
	    -security_group    => SECURITY_GROUP,
	    -user_data         => "#!/bin/bash\n/etc/init.d/gbrowse-slave start\n",
	    );
	$_->add_tag(Requestor=>'gbrowse_launch_aws_slaves') foreach @requests;
	push @potential_instances,@requests;
    }
    return @potential_instances;
}

sub adjust_configuration {
    # this is a heterogeneous list of running instances and spot instance requests
    my @potential_instances = @_;
    my @instances = grep {$_->isa('VM::EC2::Instance')} @potential_instances;
    my @addresses = map  {$_->privateDnsName}           @instances;
    warn "Adding slaves at address @addresses";
    my @a         = map {("http://$_:8101",
			  "http://$_:8102",
			  "http://$_:8103")} @addresses;
    my @args      = map  {('--set'=> "$_") } @a;
    system 'sudo','gbrowse_add_slaves.pl',@args;
}

sub terminate_instances {
    $ec2 or return;
    warn "terminating all slave instances";
    my @spot_requests = $ec2->describe_spot_instance_requests({'tag:Requestor' => 'gbrowse_launch_aws_slaves'});
    my @instances     = $ec2->describe_instances({'tag:GBrowseMaster'=>$instanceId});
    my %to_terminate = map {$_=>1} @instances;
    foreach (@spot_requests) {
	$to_terminate{$_->instance}++;
	$ec2->cancel_spot_instance_requests($_);
    }
    $ec2->terminate_instances(keys %to_terminate);
    system 'sudo','gbrowse_add_slaves.pl','--set','';
}

END { terminate_instances() }